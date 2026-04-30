(function (global) {
  'use strict';

  function isAssociationField(fieldName, catalogFields) {
    return catalogFields[fieldName]?.source === 'association';
  }

  function hasAssociationConditions(conditions, catalogFields) {
    return conditions.some(c => isAssociationField(c.field, catalogFields));
  }

  function liquidTag(content, indent = '', trim = false) {
    return `${indent}${trim ? `{%- ${content} -%}` : `{% ${content} %}`}`;
  }

  function conditionFieldRef(condition, catalogFields) {
    return isAssociationField(condition.field, catalogFields)
      ? `assoc_${condition.field}`
      : `catalog_item.${condition.field}`;
  }

  function quoteLiquidString(value) {
    return `"${String(value || '').replace(/"/g, '\\"')}"`;
  }

  function expandPresetCondition(operator, days, field) {
    const cutoffVar = `cutoff_${operator.toLowerCase()}_${days}`;
    const fieldTs = `${field}_ts`;

    switch (operator) {
      case 'MORE_THAN_DAYS_AGO':
        return `catalog_item.${field} != blank and ${fieldTs} < ${cutoffVar}`;
      case 'LESS_THAN_DAYS_AGO':
        return `catalog_item.${field} != blank and ${fieldTs} >= ${cutoffVar} and ${fieldTs} <= now_ts`;
      case 'MORE_THAN_DAYS_IN_FUTURE':
        return `catalog_item.${field} != blank and ${fieldTs} > ${cutoffVar}`;
      case 'LESS_THAN_DAYS_IN_FUTURE':
        return `catalog_item.${field} != blank and ${fieldTs} >= now_ts and ${fieldTs} <= ${cutoffVar}`;
      default:
        return `catalog_item.${field} != blank`;
    }
  }

  function replacePresetPlaceholders(expression) {
    return expression.replace(/__PRESET_(\w+)_(\d+)_DAYS__:(\w+)/g, (_, operator, days, field) => {
      return expandPresetCondition(operator, days, field);
    });
  }

  function buildConditionLiquid(condition, options) {
    const { catalogFields, operatorsByType } = options;
    const fieldType = catalogFields[condition.field]?.type || 'string';
    const op = (operatorsByType[fieldType] || operatorsByType.string || {})[condition.operator];
    const isAssoc = isAssociationField(condition.field, catalogFields);
    const field = conditionFieldRef(condition, catalogFields);
    const value = String(condition.value || '').trim();
    const fieldVar = fieldType === 'number' ? `${condition.field}_num` : field;

    if (!op) { return `${fieldVar} == ${quoteLiquidString(value)}`; }

    if (op.noValue) {
      if (fieldType === 'boolean') {
        const boolField = isAssoc ? field : `${condition.field}_bool`;

        switch (condition.operator) {
          case 'is_true':
            return `${boolField} == true`;
          case 'is_false':
            return `${boolField} == false`;
          case 'is_true_or_not_set':
            return `${field} == blank or ${boolField} == true`;
          case 'is_false_or_not_set':
            return `${field} == blank or ${boolField} == false`;
          case 'is_not_blank':
            return `${field} != blank`;
          case 'is_blank':
            return `${field} == blank`;
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
      const [minVal = '', maxVal = ''] = value.split(',').map(v => v.trim());
      if (fieldType === 'datetime') {
        const fieldShort = `${condition.field}_short`;
        if (minVal && maxVal) return `${field} != blank and ${fieldShort} >= ${quoteLiquidString(minVal)} and ${fieldShort} <= ${quoteLiquidString(maxVal)}`;
        if (minVal) return `${field} != blank and ${fieldShort} >= ${quoteLiquidString(minVal)}`;
        if (maxVal) return `${field} != blank and ${fieldShort} <= ${quoteLiquidString(maxVal)}`;
      } else if (fieldType === 'number') {
        if (minVal && maxVal) return `${fieldVar} >= ${minVal} and ${fieldVar} <= ${maxVal}`;
        if (minVal) return `${fieldVar} >= ${minVal}`;
        if (maxVal) return `${fieldVar} <= ${maxVal}`;
      }
      return `${field} != blank`;
    }

    if (op.preset && fieldType === 'datetime') {
      const days = parseInt(value, 10) || 0;
      if (days <= 0) return `${field} != blank`;
      return `__PRESET_${condition.operator.toUpperCase()}_${days}_DAYS__:${condition.field}`;
    }

    if (op.multiValue) {
      const values = value.split(',').map(v => v.trim()).filter(Boolean);
      switch (condition.operator) {
        case 'is_any_of':
          return values.length > 1 ? values.map(v => `${field} == ${quoteLiquidString(v)}`).join(' or ') : `${field} == ${quoteLiquidString(values[0] || '')}`;
        case 'is_none_of':
          return values.length > 1 ? values.map(v => `${field} != ${quoteLiquidString(v)}`).join(' and ') : `${field} != ${quoteLiquidString(values[0] || '')}`;
        case 'contains_any_of':
          return values.length > 1 ? values.map(v => `${field} contains ${quoteLiquidString(v)}`).join(' or ') : `${field} contains ${quoteLiquidString(values[0] || '')}`;
        case 'doesnt_contain_any_of':
          return values.length > 0
            ? values.map(v => `${field} contains ${quoteLiquidString(v)}`).join(' or ')
            : `${field} != blank`;
      }
    }

    if (fieldType === 'datetime' && value) {
      const fieldShort = `${condition.field}_short`;
      return `${field} != blank and ${fieldShort} ${op.liquid} ${quoteLiquidString(value)}`;
    }

    if (fieldType === 'number') { return `${fieldVar} ${op.liquid} ${value || 0}`; }
    return `${field} ${op.liquid} ${quoteLiquidString(value)}`;
  }

  function parseLogicToLiquid(options) {
    const { conditions, logicExpression } = options;
    const expr = conditions.length < 3 ? null : (logicExpression || '').trim();
    if (!expr || conditions.length < 3) {
      return conditions.map(c => replacePresetPlaceholders(buildConditionLiquid(c, options))).join(' and ');
    }

    let liquidExpr = expr;
    const placeholders = [];

    for (let i = conditions.length - 1; i >= 0; i--) {
      const c = conditions[i];
      const n = (i + 1).toString();
      const placeholder = `__CONDITION_${i}_PLACEHOLDER__`;
      const re = new RegExp(`\\b${n}\\b`, 'g');
      liquidExpr = liquidExpr.replace(re, placeholder);
      placeholders.push({ placeholder, liquid: replacePresetPlaceholders(buildConditionLiquid(c, options)) });
    }

    placeholders.forEach(({ placeholder, liquid }) => {
      liquidExpr = liquidExpr.replace(new RegExp(placeholder, 'g'), liquid);
    });

    return liquidExpr.replace(/\band/gi, 'and').replace(/\bor/gi, 'or');
  }

  function getPresetConditions(conditions, options) {
    const { catalogFields, operatorsByType } = options;
    return conditions
      .filter(c => {
        const fieldType = catalogFields[c.field]?.type || 'string';
        const op = (operatorsByType[fieldType] || {})[c.operator];
        return fieldType === 'datetime' && op?.preset && parseInt(c.value, 10) > 0;
      })
      .map(c => ({ operator: c.operator.toUpperCase(), days: parseInt(c.value, 10), field: c.field }));
  }

  function buildDateCutoffSetup(presets, indent = '', trim = false) {
    if (presets.length === 0) return '';

    let output = '';
    output += `\n${liquidTag('comment', indent, trim)} Calculate date cutoffs ${liquidTag('endcomment', '', trim)}`;
    output += `\n${liquidTag('assign seconds_per_day = 86400', indent, trim)}`;
    output += `\n${liquidTag('assign now_ts = "now" | date: "%s" | plus: 0', indent, trim)}`;

    const uniqueCutoffs = new Set();
    presets.forEach(({ operator, days }) => uniqueCutoffs.add(`${operator}_${days}`));

    uniqueCutoffs.forEach(cutoff => {
      const parts = cutoff.split('_');
      const days = parseInt(parts.pop(), 10);
      const operator = parts.join('_');
      const varName = `cutoff_${cutoff.toLowerCase()}`;
      const secondsToAdjust = days * 86400;
      const operation = operator.includes('AGO') ? 'minus' : 'plus';
      output += `\n${liquidTag(`assign ${varName} = now_ts | ${operation}: ${secondsToAdjust} | plus: 0`, indent, trim)}`;
    });

    return output + '\n';
  }

  function getUsedFields(conditions, extraFields = []) {
    return new Set([...conditions.map(c => c.field).filter(Boolean), ...extraFields.filter(Boolean)]);
  }

  function buildCoercions(options, mode = 'standard', indent = '    ', trim = false, extraFields = []) {
    const { conditions, catalogFields, operatorsByType } = options;
    const usedFields = getUsedFields(conditions, extraFields);
    const presets = getPresetConditions(conditions, options);

    const numberFields = new Set();
    const boolFields = new Set();
    const dateShortFields = new Set();
    const dateTsFields = new Set();

    conditions.forEach(c => {
      if (!usedFields.has(c.field)) return;
      const fieldType = catalogFields[c.field]?.type || 'string';
      const op = (operatorsByType[fieldType] || {})[c.operator];

      if (fieldType === 'number' && (mode === 'qa' || (op && !op.noValue))) {
        numberFields.add(c.field);
      }

      if (fieldType === 'boolean' && !isAssociationField(c.field, catalogFields)) {
        boolFields.add(c.field);
      }

      if (fieldType === 'datetime' && op && !op.preset && !op.noValue) {
        dateShortFields.add(c.field);
      }

      if (fieldType === 'datetime' && mode === 'qa') {
        dateTsFields.add(c.field);
      }
    });

    presets.forEach(({ field }) => dateTsFields.add(field));

    let output = '';

    if (dateShortFields.size > 0) {
      output += `\n${liquidTag('comment', indent, trim)} Slice date fields to YYYY-MM-DD format ${liquidTag('endcomment', '', trim)}`;
      dateShortFields.forEach(field => {
        output += `\n${liquidTag(`if catalog_item.${field} != blank`, indent, trim)}`;
        output += `\n${liquidTag(`assign ${field}_short = catalog_item.${field} | slice: 0, 10`, `${indent}    `, trim)}`;
        output += `\n${liquidTag('endif', indent, trim)}`;
      });
      output += '\n';
    }

    if (dateTsFields.size > 0) {
      output += `\n${liquidTag('comment', indent, trim)} Convert date fields to timestamps ${liquidTag('endcomment', '', trim)}`;
      dateTsFields.forEach(field => {
        output += `\n${liquidTag(`assign ${field}_ts = 0`, indent, trim)}`;
        output += `\n${liquidTag(`if catalog_item.${field} != blank`, indent, trim)}`;
        output += `\n${liquidTag(`assign ${field}_ts = catalog_item.${field} | date: "%s" | plus: 0`, `${indent}    `, trim)}`;
        output += `\n${liquidTag('endif', indent, trim)}`;
      });
      output += '\n';
    }

    if (numberFields.size > 0) {
      output += `\n${liquidTag('comment', indent, trim)} Coerce number fields to numeric type ${liquidTag('endcomment', '', trim)}`;
      numberFields.forEach(field => {
        output += `\n${liquidTag(`assign ${field}_num = catalog_item.${field} | plus: 0`, indent, trim)}`;
      });
      output += '\n';
    }

    if (boolFields.size > 0) {
      output += `\n${liquidTag('comment', indent, trim)} Coerce catalog boolean fields into real booleans ${liquidTag('endcomment', '', trim)}`;
      boolFields.forEach(field => {
        output += `\n${liquidTag(`assign ${field}_bool = false`, indent, trim)}`;
        output += `\n${liquidTag(`if catalog_item.${field} == "true" or catalog_item.${field} == true`, indent, trim)}`;
        output += `\n${liquidTag(`assign ${field}_bool = true`, `${indent}    `, trim)}`;
        output += `\n${liquidTag('endif', indent, trim)}`;
      });
      output += '\n';
    }

    return output;
  }

  function getAssociationFieldsUsed(conditions, catalogFields) {
    return [...new Set(conditions
      .map(c => c.field)
      .filter(field => isAssociationField(field, catalogFields)))];
  }

  function buildAssociationLookup(options, indent = '    ', trim = false) {
    const { conditions, catalogFields } = options;
    const associationFields = getAssociationFieldsUsed(conditions, catalogFields);
    if (associationFields.length === 0) return '';

    let output = `\n${liquidTag('comment', indent, trim)} Lookup association fields from location_association_v2 ${liquidTag('endcomment', '', trim)}`;
    associationFields.forEach(field => {
      const defaultValue = catalogFields[field]?.type === 'boolean' ? 'false' : 'blank';
      output += `\n${liquidTag(`assign assoc_${field} = ${defaultValue}`, indent, trim)}`;
    });
    output += `\n${liquidTag('for assoc in location_association_v2', indent, trim)}`;
    output += `\n${liquidTag('if assoc.location_guid == location_guid', `${indent}    `, trim)}`;
    associationFields.forEach(field => {
      output += `\n${liquidTag(`assign assoc_${field} = assoc.${field}`, `${indent}        `, trim)}`;
    });
    output += `\n${liquidTag('break', `${indent}        `, trim)}`;
    output += `\n${liquidTag('endif', `${indent}    `, trim)}`;
    output += `\n${liquidTag('endfor', indent, trim)}\n`;

    return output;
  }

  function buildRuleEvaluation(condition, ruleVar, options, indent = '    ', trim = false) {
    const { catalogFields } = options;
    const field = conditionFieldRef(condition, catalogFields);
    const value = String(condition.value || '').trim();

    if (condition.operator === 'doesnt_contain_any_of') {
      const values = value.split(',').map(v => v.trim()).filter(Boolean);
      if (values.length === 0) {
        return [
          liquidTag(`assign ${ruleVar} = false`, indent, trim),
          liquidTag(`if ${field} != blank`, indent, trim),
          liquidTag(`assign ${ruleVar} = true`, `${indent}    `, trim),
          liquidTag('endif', indent, trim)
        ].join('\n') + '\n';
      }

      let output = `${liquidTag(`assign ${ruleVar} = true`, indent, trim)}\n`;
      values.forEach(item => {
        output += `${liquidTag(`if ${field} contains ${quoteLiquidString(item)}`, indent, trim)}\n`;
        output += `${liquidTag(`assign ${ruleVar} = false`, `${indent}    `, trim)}\n`;
        output += `${liquidTag('endif', indent, trim)}\n`;
      });
      return output;
    }

    const expression = replacePresetPlaceholders(buildConditionLiquid(condition, options));
    return [
      liquidTag(`assign ${ruleVar} = false`, indent, trim),
      liquidTag(`if ${expression}`, indent, trim),
      liquidTag(`assign ${ruleVar} = true`, `${indent}    `, trim),
      liquidTag('endif', indent, trim)
    ].join('\n') + '\n';
  }

  function tokenizeLogic(expression) {
    return (String(expression || '').toLowerCase().match(/\d+|\(|\)|and|or/g) || []);
  }

  function parseLogicAst(expression, conditionCount) {
    const tokens = tokenizeLogic(expression);
    let position = 0;

    function parsePrimary() {
      const token = tokens[position++];
      if (!token) return null;

      if (/^\d+$/.test(token)) {
        const index = Number(token);
        if (index < 1 || index > conditionCount) return null;
        return { type: 'rule', index };
      }

      if (token === '(') {
        const node = parseOr();
        if (tokens[position] !== ')') return null;
        position++;
        return node;
      }

      return null;
    }

    function parseAnd() {
      let node = parsePrimary();
      while (tokens[position] === 'and') {
        position++;
        const right = parsePrimary();
        if (!node || !right) return null;
        node = { type: 'and', left: node, right };
      }
      return node;
    }

    function parseOr() {
      let node = parseAnd();
      while (tokens[position] === 'or') {
        position++;
        const right = parseAnd();
        if (!node || !right) return null;
        node = { type: 'or', left: node, right };
      }
      return node;
    }

    const ast = parseOr();
    return ast && position === tokens.length ? ast : null;
  }

  function defaultLogicAst(conditionCount) {
    const rules = Array.from({ length: conditionCount }, (_, i) => ({ type: 'rule', index: i + 1 }));
    return rules.reduce((left, right) => left ? { type: 'and', left, right } : right, null);
  }

  function emitLogicAst(node, state, indent = '    ', trim = false) {
    if (!node) return { varName: 'condition_matches', block: `${liquidTag('assign condition_matches = false', indent, trim)}\n` };

    if (node.type === 'rule') {
      return { varName: `rule_${node.index}`, block: '' };
    }

    const left = emitLogicAst(node.left, state, indent, trim);
    const right = emitLogicAst(node.right, state, indent, trim);
    const varName = `logic_${state.next++}`;
    const operator = node.type === 'and' ? 'and' : 'or';

    let block = left.block + right.block;
    block += `${liquidTag(`assign ${varName} = false`, indent, trim)}\n`;
    block += `${liquidTag(`if ${left.varName} == true ${operator} ${right.varName} == true`, indent, trim)}\n`;
    block += `${liquidTag(`assign ${varName} = true`, `${indent}    `, trim)}\n`;
    block += `${liquidTag('endif', indent, trim)}\n`;

    return { varName, block };
  }

  function buildConditionEvaluationBlock(options, indent = '    ', trim = false) {
    const { conditions, logicExpression } = options;
    let output = `\n${liquidTag('comment', indent, trim)} Evaluate builder rules without parentheses ${liquidTag('endcomment', '', trim)}\n`;

    conditions.forEach((condition, index) => {
      output += buildRuleEvaluation(condition, `rule_${index + 1}`, options, indent, trim);
    });

    const ast = parseLogicAst(logicExpression, conditions.length) || defaultLogicAst(conditions.length);
    const compiled = emitLogicAst(ast, { next: 1 }, indent, trim);
    output += compiled.block;
    output += `${liquidTag('assign condition_matches = false', indent, trim)}\n`;
    output += `${liquidTag(`if ${compiled.varName} == true`, indent, trim)}\n`;
    output += `${liquidTag('assign condition_matches = true', `${indent}    `, trim)}\n`;
    output += `${liquidTag('endif', indent, trim)}\n`;

    return output;
  }

  function buildRuntimeBlocks(options, mode = 'standard', indent = '    ', trim = false, extraFields = []) {
    return [
      buildAssociationLookup(options, indent, trim),
      buildCoercions(options, mode, indent, trim, extraFields),
      buildConditionEvaluationBlock(options, indent, trim)
    ].join('');
  }

  function buildGuards(options, mode, indent = '', trim = false) {
    const { locationsAttr, associationAttr, conditions, catalogFields } = options;
    const useAssociation = hasAssociationConditions(conditions, catalogFields);

    let output = '';

    if (mode === 'qa') {
      output += `\n${indent}{%- assign user_locations = custom_attribute.\${${locationsAttr}} -%}`;
      output += `\n${indent}{%- if user_locations == blank -%}`;
      output += `\n${indent}  {%- abort_message("${locationsAttr} is blank") -%}`;
      output += `\n${indent}{%- endif -%}`;

      if (useAssociation) {
        output += `\n${indent}{%- assign ${associationAttr} = custom_attribute.\${${associationAttr}} -%}`;
        output += `\n${indent}{%- if ${associationAttr} == blank -%}`;
        output += `\n${indent}  {%- abort_message("${associationAttr} is blank") -%}`;
        output += `\n${indent}{%- endif -%}`;
      }
    } else {
      output += `{% assign user_locations = custom_attribute.\${${locationsAttr}} %}\n`;
      output += `{% if user_locations == blank %}\n`;
      output += `    {% abort_message("${locationsAttr} is blank") %}\n`;
      output += `{% endif %}\n`;

      if (useAssociation) {
        output += `\n{% assign ${associationAttr} = custom_attribute.\${${associationAttr}} %}\n`;
        output += `{% if ${associationAttr} == blank %}\n`;
        output += `    {% abort_message("${associationAttr} is blank") %}\n`;
        output += `{% endif %}\n`;
      }
    }

    return output;
  }

  function generateLiquid(mode = 'standard', options) {
    const {
      locationsAttr,
      associationAttr,
      catalogName
    } = options;
    const setupVars = buildDateCutoffSetup(getPresetConditions(options.conditions, options));
    const guards = buildGuards(options, mode);

    const runtimeBlocks = buildRuntimeBlocks(options, 'standard');
    let output = `{% comment %} Generated by Braze Zero-Copy Query Builder${mode === 'context' ? ' (Context Mode)' : ''}${mode === 'webhook' ? ' (Webhook Mode)' : ''} {% endcomment %}\n`;

    if (mode === 'webhook') {
      output += `${guards}
{% assign guid_array = context.eligible_location_guids | split: "," %}
{% assign has_match = false %}
{% assign matching_locations = "" %}
${setupVars}
{% comment %} Loop over eligible locations only {% endcomment %}
{% for guid in guid_array %}
    {% assign location_guid = guid | strip %}
    {% if location_guid != "" %}
        {% catalog_items ${catalogName} {{location_guid}} %}
        {% assign catalog_item = items[0] %}
        {% if catalog_item != blank %}${runtimeBlocks}
            {% if condition_matches == true %}
                {% assign has_match = true %}
                {% if matching_locations == "" %}
                    {% assign matching_locations = location_guid %}
                {% else %}
                    {% assign matching_locations = matching_locations | append: "," | append: location_guid %}
                {% endif %}
            {% endif %}
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
    {% if guid_clean != "" %}
        {% catalog_items ${catalogName} {{guid_clean}} %}
        {% assign catalog_item = items[0] %}
        success - Location: {{guid_clean}} matched criteria
    {% endif %}
{% endfor %}`;
      return output;
    }

    const coreLoop = `${guards}
{% assign has_match = false %}
{% assign matching_locations = "" %}
${setupVars}
{% comment %} First pass: Check if user has any matching locations {% endcomment %}
{% for location in user_locations %}
    {% assign location_guid = location.location_guid %}
    {% catalog_items ${catalogName} {{location_guid}} %}
    {% assign catalog_item = items[0] %}
    {% if catalog_item != blank %}${runtimeBlocks}
        {% if condition_matches == true %}
            {% assign has_match = true %}
            {% if matching_locations == "" %}
                {% assign matching_locations = location_guid %}
            {% else %}
                {% assign matching_locations = matching_locations | append: "," | append: location_guid %}
            {% endif %}
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
    {% assign guid_clean = guid | strip %}
    {% if guid_clean != "" %}
        {% catalog_items ${catalogName} {{guid_clean}} %}
        {% assign catalog_item = items[0] %}
        success - Location: {{guid_clean}} matched criteria
    {% endif %}
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
      locationsAttr,
      associationAttr,
      catalogName
    } = options;
    const useAssociation = hasAssociationConditions(options.conditions, options.catalogFields);
    const evidenceFields = getEvidenceFieldsFromConditions(options.conditions);
    const evidenceObjectLiquid = buildEvidenceObjectLiquid(options.conditions, options.catalogFields);
    const setupVars = buildDateCutoffSetup(getPresetConditions(options.conditions, options), '            ', true);
    const runtimeBlocks = buildRuntimeBlocks(options, 'qa', '              ', true, evidenceFields);

    const guards = buildGuards(options, 'qa', '            ', true);

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

            {%- comment -%} Zero-copy inputs {%- endcomment -%}${guards}${setupVars}

            {%- comment -%} Build matched locations JSON {%- endcomment -%}
            {%- assign has_match = false -%}
            {%- capture matched_locations_json -%}[{%- endcapture -%}
            {%- assign match_count = 0 -%}

            {%- for location in user_locations -%}
              {%- assign location_guid = location.location_guid -%}
              {%- catalog_items ${catalogName} {{location_guid}} -%}
              {%- assign catalog_item = items[0] -%}
              {%- if catalog_item != blank -%}${runtimeBlocks}
                {%- if condition_matches == true -%}

                  {%- assign has_match = true -%}
                  {%- if match_count > 0 -%}
                    {%- capture matched_locations_json -%}{{- matched_locations_json -}}, {%- endcapture -%}
                  {%- endif -%}

                  {%- capture matched_locations_json -%}{{- matched_locations_json -}}${evidenceObjectLiquid}{%- endcapture -%}

                  {%- assign match_count = match_count | plus: 1 -%}
                {%- endif -%}
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
