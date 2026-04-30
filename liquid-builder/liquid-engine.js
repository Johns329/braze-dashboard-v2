(function (global) {
  'use strict';

  function isAssociationField(fieldName, catalogFields) {
    return catalogFields[fieldName]?.source === 'association';
  }

  function hasAssociationConditions(conditions, catalogFields) {
    return conditions.some(c => isAssociationField(c.field, catalogFields));
  }

  function buildConditionLiquid(condition, options) {
    const { catalogFields, operatorsByType } = options;
    const fieldType = catalogFields[condition.field]?.type || 'string';
    const op = (operatorsByType[fieldType] || operatorsByType.string || {})[condition.operator];
    const isAssoc = isAssociationField(condition.field, catalogFields);

    const field = isAssoc
      ? `assoc_${condition.field}`
      : `catalog_item.${condition.field}`;

    const value = String(condition.value || '').trim();
    const fieldVar = fieldType === 'number' ? `${condition.field}_num` : field;

    if (!op) { return `${fieldVar} == "${value}"`; }

    if (op.noValue) {
      if (fieldType === 'boolean') {
        const boolField = isAssoc ? field : `${condition.field}_bool`;

        switch (condition.operator) {
          case 'is_true':
            return `${boolField} == true`;
          case 'is_false':
            return `${boolField} == false`;
          case 'is_true_or_not_set':
            return `${boolField} == true or ${boolField} == blank`;
          case 'is_false_or_not_set':
            return `${boolField} == false or ${boolField} == blank`;
          case 'is_not_blank':
            return `${boolField} != blank`;
          case 'is_blank':
            return `${boolField} == blank`;
          default:
            return `${boolField} != blank`;
        }
      }

      switch (condition.operator) {
        case 'is_not_blank':
          return `${field} != blank`;
        case 'is_blank':
          return `${field} == blank`;
        default:
          return `${field} != blank`;
      }
    }

    if (op.rangeValue) {
      const [minVal = '', maxVal = ''] = (value || '').split(',').map(v => v.trim());
      if (fieldType === 'datetime') {
        const fieldShort = `${condition.field}_short`;
        if (minVal && maxVal) return `${field} != blank and ${fieldShort} >= "${minVal}" and ${fieldShort} <= "${maxVal}"`;
        if (minVal) return `${field} != blank and ${fieldShort} >= "${minVal}"`;
        if (maxVal) return `${field} != blank and ${fieldShort} <= "${maxVal}"`;
      } else if (fieldType === 'number') {
        if (minVal && maxVal) return `${fieldVar} >= ${minVal} and ${fieldVar} <= ${maxVal}`;
        if (minVal) return `${fieldVar} >= ${minVal}`;
        if (maxVal) return `${fieldVar} <= ${maxVal}`;
      }
      return `${field} != blank`;
    }

    if (op.preset && fieldType === 'datetime') {
      const days = parseInt(value) || 0;
      if (days <= 0) return `${field} != blank`;
      return `__PRESET_${condition.operator.toUpperCase()}_${days}_DAYS__:${condition.field}`;
    }

    if (op.multiValue) {
      const values = value.split(',').map(v => v.trim()).filter(Boolean);
      switch (condition.operator) {
        case 'is_any_of':
          return values.length > 1 ? values.map(v => `${field} == "${v}"`).join(' or ') : `${field} == "${values[0] || ''}"`;
        case 'is_none_of':
          return values.length > 1 ? values.map(v => `${field} != "${v}"`).join(' and ') : `${field} != "${values[0] || ''}"`;
        case 'contains_any_of':
          return values.length > 1 ? values.map(v => `${field} contains "${v}"`).join(' or ') : `${field} contains "${values[0] || ''}"`;
        case 'doesnt_contain_any_of':
          return values.length > 0
            ? values.map(v => `${field} contains "${v}" == false`).join(' and ')
            : `${field} != blank`;
      }
    }

    if (fieldType === 'datetime' && value) {
      const fieldShort = `${condition.field}_short`;
      return `${field} != blank and ${fieldShort} ${op.liquid} "${value}"`;
    }

    if (fieldType === 'number') { return `${fieldVar} ${op.liquid} ${value || 0}`; }
    return `${field} ${op.liquid} "${value}"`;
  }

  function parseLogicToLiquid(options) {
    const { conditions, logicExpression } = options;
    const expr = conditions.length < 3 ? null : (logicExpression || '').trim();
    if (!expr || conditions.length < 3) {
      return conditions.map(c => buildConditionLiquid(c, options)).join(' and ');
    }

    let liquidExpr = expr;
    const placeholders = [];

    for (let i = conditions.length - 1; i >= 0; i--) {
      const c = conditions[i];
      const n = (i + 1).toString();
      const placeholder = `__CONDITION_${i}_PLACEHOLDER__`;
      const re = new RegExp(`\\b${n}\\b`, 'g');
      liquidExpr = liquidExpr.replace(re, placeholder);
      placeholders.push({ placeholder, liquid: buildConditionLiquid(c, options) });
    }

    placeholders.forEach(({ placeholder, liquid }) => {
      liquidExpr = liquidExpr.replace(new RegExp(placeholder, 'g'), liquid);
    });

    liquidExpr = liquidExpr.replace(/\band/gi, 'and').replace(/\bor/gi, 'or');
    return liquidExpr;
  }

  function generateLiquid(mode = 'standard', options) {
    const {
      conditions,
      catalogFields,
      operatorsByType,
      locationsAttr,
      associationAttr,
      catalogName
    } = options;
    const liquidCondition = parseLogicToLiquid(options);
    const useAssociation = hasAssociationConditions(conditions, catalogFields);

    const presetPattern = /__PRESET_(\w+)_(\d+)_DAYS__:(\w+)/g;
    const presets = [...liquidCondition.matchAll(presetPattern)];
    const hasPresets = presets.length > 0;

    let setupVars = '';
    let tsConversions = '';
    let dateSlicing = '';
    let numberCoercions = '';
    let associationLookup = '';
    let processedCondition = liquidCondition;

    if (hasPresets) {
      setupVars = `
{% comment %} Calculate date cutoffs {% endcomment %}
{% assign seconds_per_day = 86400 %}
{% assign now_ts = "now" | date: "%s" | plus: 0 %}`;

      const uniqueCutoffs = new Set();
      presets.forEach(([_, operator, days]) => { uniqueCutoffs.add(`${operator}_${days}`); });

      uniqueCutoffs.forEach(cutoff => {
        const parts = cutoff.split('_');
        const days = parseInt(parts.pop());
        const operator = parts.join('_');
        const varName = `cutoff_${cutoff.toLowerCase()}`;
        const secondsToAdjust = days * 86400;

        if (operator.includes('AGO')) {
          setupVars += `
{% assign ${varName} = now_ts | minus: ${secondsToAdjust} | plus: 0 %}`;
        } else {
          setupVars += `
{% assign ${varName} = now_ts | plus: ${secondsToAdjust} | plus: 0 %}`;
        }
      });
      setupVars += '\n';

      const fieldsToConvert = new Set();
      presets.forEach(([_, __, ___, field]) => { fieldsToConvert.add(field); });

      if (fieldsToConvert.size > 0) {
        tsConversions = '\n    {% comment %} Convert date fields to timestamps {% endcomment %}';
        fieldsToConvert.forEach(field => {
          tsConversions += `
    {% if catalog_item.${field} != blank %}
        {% assign ${field}_ts = catalog_item.${field} | date: "%s" | plus: 0 %}
    {% else %}
        {% assign ${field}_ts = 0 %}
    {% endif %}`;
        });
        tsConversions += '\n';
      }

      presets.forEach(([fullMatch, operator, days, field]) => {
        const cutoffVar = `cutoff_${operator.toLowerCase()}_${days}`;
        const fieldTs = `${field}_ts`;
        let condition;
        switch (operator) {
          case 'MORE_THAN_DAYS_AGO':
            condition = `catalog_item.${field} != blank and ${fieldTs} < ${cutoffVar}`;
            break;
          case 'LESS_THAN_DAYS_AGO':
            condition = `catalog_item.${field} != blank and ${fieldTs} >= ${cutoffVar} and ${fieldTs} <= now_ts`;
            break;
          case 'MORE_THAN_DAYS_IN_FUTURE':
            condition = `catalog_item.${field} != blank and ${fieldTs} > ${cutoffVar}`;
            break;
          case 'LESS_THAN_DAYS_IN_FUTURE':
            condition = `catalog_item.${field} != blank and ${fieldTs} >= now_ts and ${fieldTs} <= ${cutoffVar}`;
            break;
          default: condition = `catalog_item.${field} != blank`;
        }
        processedCondition = processedCondition.replace(fullMatch, condition);
      });
    }

    const usedFields = new Set();
    const fieldPattern = /catalog_item\.(\w+)/g;
    let match;
    while ((match = fieldPattern.exec(processedCondition)) !== null) { usedFields.add(match[1]); }
    const shortPattern = /(\w+)_short/g;
    while ((match = shortPattern.exec(processedCondition)) !== null) { usedFields.add(match[1]); }
    const numPattern = /(\w+)_num/g;
    while ((match = numPattern.exec(processedCondition)) !== null) { usedFields.add(match[1]); }
    const boolPattern = /(\w+)_bool/g;
    while ((match = boolPattern.exec(processedCondition)) !== null) { usedFields.add(match[1]); }

    const numberFields = new Set();
    conditions.forEach(c => {
      if (usedFields.has(c.field) && catalogFields[c.field]?.type === 'number') {
        const op = (operatorsByType.number || {})[c.operator];
        if (op && !op.noValue) { numberFields.add(c.field); }
      }
    });

    const boolFields = new Set();
    conditions.forEach(c => {
      if (
        usedFields.has(c.field) &&
        !isAssociationField(c.field, catalogFields) &&
        catalogFields[c.field]?.type === 'boolean'
      ) {
        boolFields.add(c.field);
      }
    });

    const dateFields = new Set();
    conditions.forEach(c => {
      if (usedFields.has(c.field) && catalogFields[c.field]?.type === 'datetime') {
        const op = (operatorsByType.datetime || {})[c.operator];
        if (op && !op.preset && !op.noValue) { dateFields.add(c.field); }
      }
    });

    if (dateFields.size > 0) {
      dateSlicing = '\n    {% comment %} Slice date fields to YYYY-MM-DD format {% endcomment %}';
      dateFields.forEach(field => {
        dateSlicing += `
    {% if catalog_item.${field} != blank %}
        {% assign ${field}_short = catalog_item.${field} | slice: 0, 10 %}
    {% endif %}`;
      });
      dateSlicing += '\n';
    }

    if (numberFields.size > 0) {
      numberCoercions = '\n    {% comment %} Coerce number fields to numeric type {% endcomment %}';
      numberFields.forEach(field => {
        numberCoercions += `
    {% assign ${field}_num = catalog_item.${field} | plus: 0 %}`;
      });
      numberCoercions += '\n';
    }

    let boolCoercions = '';
    if (boolFields.size > 0) {
      boolCoercions = '\n    {% comment %} Coerce catalog boolean fields (stored as strings) into real booleans {% endcomment %}';
      boolFields.forEach(field => {
        boolCoercions += `
    {% assign ${field}_bool = false %}
    {% if catalog_item.${field} == "true" %}
        {% assign ${field}_bool = true %}
    {% endif %}`;
      });
      boolCoercions += '\n';
    }

    if (useAssociation) {
      associationLookup = `
    {% comment %} Lookup association fields from location_association_v2 {% endcomment %}
    {% assign assoc_is_finance_contact = false %}
    {% assign assoc_is_service_contact = false %}
    {% for assoc in location_association_v2 %}
        {% if assoc.location_guid == location_guid %}
            {% assign assoc_is_finance_contact = assoc.is_finance_contact %}
            {% assign assoc_is_service_contact = assoc.is_service_contact %}
            {% break %}
        {% endif %}
    {% endfor %}
`;
    }

    const locationAssocSetup = useAssociation
      ? `{% assign ${associationAttr} = custom_attribute.\${${associationAttr}} %}\n`
      : '';

    let output = `{% comment %} Generated by Braze Zero-Copy Query Builder${mode === 'context' ? ' (Context Mode)' : ''}${mode === 'webhook' ? ' (Webhook Mode)' : ''} {% endcomment %}\n`;

    if (mode === 'webhook') {
      output += `{% assign guid_array = context.eligible_location_guids | split: "," %}
{% assign has_match = false %}
{% assign matching_locations = "" %}

${setupVars}
{% comment %} Loop over eligible locations only {% endcomment %}
{% for guid in guid_array %}
    {% assign location_guid = guid | strip %}
    {% if location_guid == "" %}
        {% continue %}
    {% endif %}

    {% catalog_items ${catalogName} {{location_guid}} %}
    {% assign catalog_item = items[0] %}
${associationLookup}${tsConversions}${dateSlicing}${numberCoercions}${boolCoercions}
    {% if ${processedCondition} %}
        {% assign has_match = true %}
        {% if matching_locations == "" %}
            {% assign matching_locations = location_guid %}
        {% else %}
            {% assign matching_locations = matching_locations | append: "," | append: location_guid %}
        {% endif %}
    {% endif %}
{% endfor %}

{% comment %} Abort if no matches found {% endcomment %}
{% if has_match == false %}
    {% abort_message("No matching eligible locations found for criteria") %}
{% endif %}

{% comment %} Output success for matching locations {% endcomment %}
{% assign matching_array = matching_locations | split: "," %}
{% for guid in matching_array %}
    {% assign guid_clean = guid | strip %}
    {% if guid_clean == "" %}
        {% continue %}
    {% endif %}

    {% catalog_items ${catalogName} {{guid_clean}} %}
    {% assign catalog_item = items[0] %}
    success - Location: {{guid_clean}} matched criteria
{% endfor %}`;
      return output;
    }

    const coreLoop = `{% assign user_locations = custom_attribute.\${${locationsAttr}} %}
${locationAssocSetup}{% assign has_match = false %}
{% assign matching_locations = "" %}
${setupVars}
{% comment %} First pass: Check if user has any matching locations {% endcomment %}
{% for location in user_locations %}
    {% assign location_guid = location.location_guid %}
    {% catalog_items ${catalogName} {{location_guid}} %}
    {% assign catalog_item = items[0] %}
${associationLookup}${tsConversions}${dateSlicing}${numberCoercions}${boolCoercions}
    {% if ${processedCondition} %}
        {% assign has_match = true %}
        {% if matching_locations == "" %}
            {% assign matching_locations = location_guid %}
        {% else %}
            {% assign matching_locations = matching_locations | append: "," | append: location_guid %}
        {% endif %}
    {% endif %}
{% endfor %}`;

    if (mode === 'standard') {
      output += `${coreLoop}

{% comment %} Abort if no matches found {% endcomment %}
{% if has_match == false %}
    {% abort_message("No matching locations found for criteria") %}
{% endif %}

{% comment %} Second pass: Output success for matching locations {% endcomment %}
{% assign guid_array = matching_locations | split: "," %}
{% for guid in guid_array %}
    {% catalog_items ${catalogName} {{guid}} %}
    {% assign catalog_item = items[0] %}
    success - Location: {{guid}} matched criteria
{% endfor %}`;
      return output;
    }

    if (mode === 'context') {
      output += `${coreLoop}\n\n{{ matching_locations }}`;
      return output;
    }

    return output;
  }

  function getEvidenceFieldsFromConditions(conditions) {
    const fields = conditions.map(c => c.field).filter(Boolean);
    const uniq = [...new Set(fields)];
    return ['location_guid', ...uniq.filter(f => f !== 'location_guid')];
  }

  function evidenceValueLiquid(fieldName, catalogFields) {
    if (fieldName === 'location_guid') {
      return `"{{- location_guid -}}"`;
    }

    const meta = catalogFields[fieldName] || { type: 'string' };
    const isAssoc = meta.source === 'association';
    const baseVar = isAssoc ? `assoc_${fieldName}` : `catalog_item.${fieldName}`;

    if (meta.type === 'number') {
      const numVar = isAssoc ? baseVar : `${fieldName}_num`;
      return `{{- ${numVar} | default: 0 -}}`;
    }

    if (meta.type === 'boolean') {
      const boolVar = isAssoc ? baseVar : `${fieldName}_bool`;
      return `{{- ${boolVar} | default: false -}}`;
    }

    if (meta.type === 'datetime') {
      const dateExpr = isAssoc ? baseVar : `${baseVar} | slice: 0, 10`;
      return `"{{- ${dateExpr} | default: "" -}}"`;
    }

    return `"{{- ${baseVar} | default: "" | replace: '"', '\\"' -}}"`;
  }

  function buildEvidenceObjectLiquid(conditions, catalogFields) {
    const fields = getEvidenceFieldsFromConditions(conditions);
    const ordered = [
      'location_guid',
      ...fields.filter(f => f !== 'location_guid').sort()
    ];

    return `{${ordered.map(f => `"${f}":${evidenceValueLiquid(f, catalogFields)}`).join(',')}}`;
  }

  function generateQAWebhook(options) {
    const {
      conditions,
      catalogFields,
      operatorsByType,
      locationsAttr,
      associationAttr,
      catalogName
    } = options;
    const liquidCondition = parseLogicToLiquid(options);
    const useAssociation = hasAssociationConditions(conditions, catalogFields);
    const evidenceObjectLiquid = buildEvidenceObjectLiquid(conditions, catalogFields);

    let setupVars = '';

    const presetPattern = /__PRESET_(\w+)_(\d+)_DAYS__:(\w+)/g;
    const presets = [...liquidCondition.matchAll(presetPattern)];

    if (presets.length > 0) {
      setupVars += `\n            {%- comment -%} Date cutoffs {%- endcomment -%}`;
      setupVars += `\n            {%- assign seconds_per_day = 86400 -%}`;
      setupVars += `\n            {%- assign now_ts = "now" | date: "%s" | plus: 0 -%}`;

      const uniqueCutoffs = new Set();
      presets.forEach(([_, operator, days]) => { uniqueCutoffs.add(`${operator}_${days}`); });

      uniqueCutoffs.forEach(cutoff => {
        const parts = cutoff.split('_');
        const days = parseInt(parts.pop());
        const operator = parts.join('_');
        const varName = `cutoff_${cutoff.toLowerCase()}`;
        const secondsToAdjust = days * 86400;

        if (operator.includes('AGO')) {
          setupVars += `\n            {%- assign ${varName} = now_ts | minus: ${secondsToAdjust} | plus: 0 -%}`;
        } else {
          setupVars += `\n            {%- assign ${varName} = now_ts | plus: ${secondsToAdjust} | plus: 0 -%}`;
        }
      });
    }

    let processedCondition = liquidCondition;
    presets.forEach(([fullMatch, operator, days, field]) => {
      const cutoffVar = `cutoff_${operator.toLowerCase()}_${days}`;
      const fieldTs = `${field}_ts`;
      let condition;

      switch (operator) {
        case 'MORE_THAN_DAYS_AGO':
          condition = `catalog_item.${field} != blank and ${fieldTs} < ${cutoffVar}`;
          break;
        case 'LESS_THAN_DAYS_AGO':
          condition = `catalog_item.${field} != blank and ${fieldTs} >= ${cutoffVar} and ${fieldTs} <= now_ts`;
          break;
        case 'MORE_THAN_DAYS_IN_FUTURE':
          condition = `catalog_item.${field} != blank and ${fieldTs} > ${cutoffVar}`;
          break;
        case 'LESS_THAN_DAYS_IN_FUTURE':
          condition = `catalog_item.${field} != blank and ${fieldTs} >= now_ts and ${fieldTs} <= ${cutoffVar}`;
          break;
        default:
          condition = `catalog_item.${field} != blank`;
      }

      processedCondition = processedCondition.replace(fullMatch, condition);
    });

    const usedFields = new Set();
    const fieldPattern = /catalog_item\.(\w+)/g;
    let match;
    while ((match = fieldPattern.exec(processedCondition)) !== null) { usedFields.add(match[1]); }

    getEvidenceFieldsFromConditions(conditions).forEach(f => {
      if (f && f !== 'location_guid') usedFields.add(f);
    });

    const numberFields = new Set();
    conditions.forEach(c => {
      if (usedFields.has(c.field) && catalogFields[c.field]?.type === 'number') {
        const op = (operatorsByType.number || {})[c.operator];
        if (op && !op.noValue) numberFields.add(c.field);
      }
    });

    const boolFields = new Set();
    conditions.forEach(c => {
      if (usedFields.has(c.field) && !isAssociationField(c.field, catalogFields) && catalogFields[c.field]?.type === 'boolean') {
        boolFields.add(c.field);
      }
    });

    const dateFields = new Set();
    conditions.forEach(c => {
      if (usedFields.has(c.field) && catalogFields[c.field]?.type === 'datetime') {
        dateFields.add(c.field);
      }
    });
    presets.forEach(([_, __, ___, field]) => { dateFields.add(field); });

    let coercions = '';
    if (dateFields.size > 0) {
      coercions += `\n              {%- comment -%} Dates to ts {%- endcomment -%}`;
      dateFields.forEach(field => {
        coercions += `
              {%- assign ${field}_ts = 0 -%}
              {%- if catalog_item.${field} != blank -%}
                {%- assign ${field}_ts = catalog_item.${field} | date: "%s" | plus: 0 -%}
              {%- endif -%}`;
      });
    }

    if (numberFields.size > 0) {
      coercions += `\n              {%- comment -%} Number coercions {%- endcomment -%}`;
      numberFields.forEach(field => {
        coercions += `
              {%- assign ${field}_num = catalog_item.${field} | plus: 0 -%}`;
      });
    }

    if (boolFields.size > 0) {
      coercions += `\n              {%- comment -%} Bool coercions {%- endcomment -%}`;
      boolFields.forEach(field => {
        coercions += `
              {%- assign ${field}_bool = false -%}
              {%- if catalog_item.${field} == "true" -%}
                {%- assign ${field}_bool = true -%}
              {%- endif -%}`;
      });
    }

    let assocBlock = '';
    if (useAssociation) {
      assocBlock = `
              {%- comment -%} Assoc lookup {%- endcomment -%}
              {%- assign assoc_is_finance_contact = false -%}
              {%- assign assoc_is_service_contact = false -%}
              {%- for assoc in location_association_v2 -%}
                {%- if assoc.location_guid == location_guid -%}
                  {%- assign assoc_is_finance_contact = assoc.is_finance_contact -%}
                  {%- assign assoc_is_service_contact = assoc.is_service_contact -%}
                  {%- break -%}
                {%- endif -%}
              {%- endfor -%}`;
    }

    const locationAssocSetup = useAssociation
      ? `\n            {%- assign ${associationAttr} = custom_attribute.\${${associationAttr}} -%}`
      : '';

    return `{
  "attributes": [
    {
      "external_id": "{{\${user_id}}}",
      "_merge_objects": false,
      "QA": {
        "QA_Tester": {
          "Latest QA Test": {
            "run_ts": "{{- 'now' | date: '%Y-%m-%dT%H:%M:%SZ' -}}",
            "rule_version": "v2_zero_copy_2025-01-20",

            {%- comment -%} Zero-copy inputs {%- endcomment -%}
            {%- assign user_locations = custom_attribute.\${${locationsAttr}} -%}${locationAssocSetup}${setupVars}

            {%- comment -%} Build matched locations JSON {%- endcomment -%}
            {%- assign has_match = false -%}
            {%- capture matched_locations_json -%}[{%- endcapture -%}
            {%- assign match_count = 0 -%}

            {%- for location in user_locations -%}
              {%- assign location_guid = location.location_guid -%}
              {%- catalog_items ${catalogName} {{location_guid}} -%}
              {%- assign catalog_item = items[0] -%}
${assocBlock}${coercions}

              {%- comment -%} Eligibility criteria {%- endcomment -%}
              {%- if ${processedCondition} -%}

                {%- assign has_match = true -%}
                {%- if match_count > 0 -%}
                  {%- capture matched_locations_json -%}{{- matched_locations_json -}}, {%- endcapture -%}
                {%- endif -%}

                {%- capture matched_locations_json -%}{{- matched_locations_json -}}${evidenceObjectLiquid}{%- endcapture -%}

                {%- assign match_count = match_count | plus: 1 -%}
              {%- endif -%}
            {%- endfor -%}

            {%- capture matched_locations_json -%}{{- matched_locations_json -}}]{%- endcapture -%}

            "matched_locations": {{- matched_locations_json | strip_newlines | replace: "  ", "" | strip -}}{%- if has_match == false -%},
            "no_match_reason": "No matching locations found for criteria"{%- endif -%}
          }
        }
      }
    }
  ]
}`;
  }

  global.LiquidEngine = {
    isAssociationField,
    hasAssociationConditions,
    buildConditionLiquid,
    parseLogicToLiquid,
    generateLiquid,
    getEvidenceFieldsFromConditions,
    evidenceValueLiquid,
    buildEvidenceObjectLiquid,
    generateQAWebhook
  };
})(typeof window !== 'undefined' ? window : globalThis);
