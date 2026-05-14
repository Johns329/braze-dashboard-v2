/**
 * ai-assistant_ai.js
 *
 * Schema-aware AI assistant for Toast Audience Studio. The browser sends the
 * OpenAI-compatible request body to Pipedream; Pipedream stores the API key and
 * forwards the request to OpenAI.
 */
window.AIAssistant = (function () {
  'use strict';

  const DEFAULT_WEBHOOK_URL = 'https://eocvybpvou4thly.m.pipedream.net';
  const DEFAULT_MODEL = 'gpt-4o';
  const REQUEST_TIMEOUT_MS = 60000;

  const STATE_NAME_TO_CODE = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
    connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
    illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
    maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
    mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
    pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
    tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
    'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'washington dc': 'DC',
    'washington, dc': 'DC', dc: 'DC'
  };

  let conversationHistory = [];
  let runtimeConfig = {
    webhookUrl: DEFAULT_WEBHOOK_URL,
    model: DEFAULT_MODEL,
    timeoutMs: REQUEST_TIMEOUT_MS
  };

  function configure(options = {}) {
    runtimeConfig = {
      ...runtimeConfig,
      ...options
    };
  }

  function getFields() {
    return window.CATALOG_FIELDS || {};
  }

  function getBuilderConfig() {
    return window.BUILDER_CONFIG || {};
  }

  function getOperatorsByType() {
    return getBuilderConfig().operatorsByType || {};
  }

  function sourceLabel(fieldMeta = {}) {
    return fieldMeta.source === 'association'
      ? 'User Attribute from location_association_v2'
      : 'Location Attribute from Primary_Locations_Catalog';
  }

  function describeOperatorValue(operator = {}) {
    if (operator.noValue) return 'no value; use an empty string';
    if (operator.rangeValue) return 'range value as "min,max"';
    if (operator.multiValue) return 'comma-separated list';
    if (operator.preset) return 'positive integer number of days';
    return 'single string value';
  }

  function buildFieldSummary() {
    const fields = getFields();
    return Object.keys(fields)
      .sort((a, b) => {
        const aAssoc = fields[a]?.source === 'association' ? 0 : 1;
        const bAssoc = fields[b]?.source === 'association' ? 0 : 1;
        return aAssoc - bAssoc || a.localeCompare(b);
      })
      .map(key => {
        const field = fields[key];
        return `- ${key} | type: ${field.type} | label: ${field.label} | source: ${sourceLabel(field)}`;
      })
      .join('\n');
  }

  function buildOperatorSummary() {
    const operatorsByType = getOperatorsByType();
    return Object.keys(operatorsByType)
      .map(type => {
        const operators = operatorsByType[type] || {};
        const lines = Object.keys(operators).map(key => {
          const operator = operators[key];
          return `- ${key} | label: ${operator.label} | liquid: ${operator.liquid} | value: ${describeOperatorValue(operator)}`;
        });
        return `${type}:\n${lines.join('\n')}`;
      })
      .join('\n\n');
  }

  function conditionLiquidExample(condition) {
    if (!window.LiquidEngine?.buildConditionLiquid) return '';
    try {
      return window.LiquidEngine.buildConditionLiquid(condition, {
        catalogFields: getFields(),
        operatorsByType: getOperatorsByType()
      });
    } catch (err) {
      return '';
    }
  }

  function buildLiquidExamples() {
    const examples = [
      { phrase: 'SMB locations', condition: { field: 'account_segment', operator: 'equals', value: 'SMB' } },
      { phrase: 'locations in Maryland', condition: { field: 'location_state', operator: 'is_any_of', value: 'MD' } },
      { phrase: 'has KDS', condition: { field: 'has_kds', operator: 'is_true', value: '' } },
      { phrase: 'finance contacts', condition: { field: 'is_finance_contact', operator: 'is_true', value: '' } }
    ];

    return examples
      .filter(example => getFields()[example.condition.field])
      .map(example => {
        const liquid = conditionLiquidExample(example.condition);
        return `- ${example.phrase}: ${JSON.stringify(example.condition)}${liquid ? ` -> ${liquid}` : ''}`;
      })
      .join('\n');
  }

  function buildSystemPrompt() {
    const builderConfig = getBuilderConfig();
    const stateMap = Object.keys(STATE_NAME_TO_CODE)
      .filter(name => name.length > 2 && !name.includes(','))
      .map(name => `${name}=${STATE_NAME_TO_CODE[name]}`)
      .join(', ');

    return `You are an expert AI assistant that builds target audience queries for Toast Audience Studio. Convert natural language into the exact structured query JSON used by the builder UI.

Builder Runtime Configuration:
- locations user attribute: ${builderConfig.locationsAttr || 'locations_v2'}
- association user attribute: ${builderConfig.associationAttr || 'location_association_v2'}
- location catalog: ${builderConfig.catalogName || 'Primary_Locations_Catalog'}
- The user qualifies when at least one location matches the generated conditions.

How this builder compiles to Liquid:
- Location/catalog fields are evaluated as catalog_item.<field> after loading a Primary_Locations_Catalog item by location_guid.
- Association fields have source "association" and are read from location_association_v2 for the same location_guid, then evaluated as assoc_<field>.
- Catalog boolean fields are coerced into real booleans before evaluation; association booleans are used directly.
- Datetime fields may use explicit YYYY-MM-DD values or day-offset preset operators.
- Multi-value operators expect comma-separated strings. For "doesnt_contain_any_of", the builder checks that none of the values are contained.
- Advanced logic uses 1-based condition numbers with "and", "or", and parentheses.

Available Fields:
${buildFieldSummary()}

Available Operators:
${buildOperatorSummary()}

Liquid-aware Examples:
${buildLiquidExamples()}

US State Mapping:
Use USPS abbreviations for location_state values when the user gives state names. Examples: ${stateMap}.

Response Contract:
Always respond with valid raw JSON only. Do not include markdown or prose outside the JSON.

If the request is ambiguous or cannot be mapped to available fields, return:
{
  "status": "clarification_needed",
  "message": "Your concise question to the user."
}

If the request is clear, return:
{
  "status": "confirm",
  "message": "I've drafted the query based on your request. Please review the explanation and confirm whether it is correct.",
  "plainEnglishExplanation": "This query identifies users with at least one SMB location in Maryland.",
  "conditions": [
    { "field": "exact_field_key", "operator": "exact_operator_key", "value": "value_as_string" }
  ],
  "advancedLogic": "1 and (2 or 3)"
}

Rules:
1. Only use fields that exist in Available Fields. Never invent fields.
2. Only use operators valid for the selected field type.
3. Always make "value" a string. Use "" for no-value operators such as is_true, is_false, is_blank, and is_not_blank.
4. For multi-value operators, use a comma-separated string such as "MD, DC".
5. For range operators, use "min,max" with either side blank only when needed.
6. Use USPS state codes for location_state values even if the user writes full state names.
7. Prefer account_segment equals SMB, Mid Market, Enterprise, or similar exact values when the user names a segment.
8. Map contact/role requirements like finance contact and service contact to association fields.
9. The plainEnglishExplanation must be one short, non-technical sentence that starts with "This query identifies".
10. Do not mention condition numbers, filter numbers, advanced logic syntax, or implementation details in plainEnglishExplanation.
11. Include advancedLogic whenever there are two or more conditions. Use "1 and 2" for simple AND logic.
12. If a campaign brief is included, infer only from explicit objective, target audience, eligibility, exclusions, product, geography, segment, role/contact-type, lifecycle, and timing details.`;
  }

  function ensureSystemMessage() {
    if (conversationHistory.length === 0) {
      conversationHistory.push({ role: 'system', content: buildSystemPrompt() });
    }
  }

  function parseJSON(text, fallbackMessage) {
    const value = String(text || '').trim();
    try {
      return JSON.parse(value);
    } catch (err) {
      const start = value.indexOf('{');
      const end = value.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(value.slice(start, end + 1));
      }
      throw new Error(fallbackMessage || 'Response was not valid JSON.');
    }
  }

  function maybeParseString(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      return value;
    }
  }

  function unwrapOpenAIResponse(data) {
    let payload = maybeParseString(data);
    if (payload?.choices) return payload;
    if (payload?.body) {
      payload = maybeParseString(payload.body);
      if (payload?.choices) return payload;
    }
    if (payload?.$return_value) {
      payload = maybeParseString(payload.$return_value);
      if (payload?.choices) return payload;
      if (payload?.body) {
        payload = maybeParseString(payload.body);
        if (payload?.choices) return payload;
      }
    }
    return maybeParseString(data);
  }

  function normalizeAssistantResponse(parsed) {
    if (parsed.status === 'clarification') {
      return {
        status: 'clarification_needed',
        message: parsed.message || 'Can you clarify the audience you want to build?'
      };
    }

    if (parsed.status === 'success') {
      return {
        status: 'confirm',
        message: parsed.message || "I've drafted the query based on your request. Please review the explanation and confirm whether it is correct.",
        plainEnglishExplanation: parsed.plainEnglishExplanation || '',
        conditions: normalizeConditions(parsed.conditions),
        advancedLogic: parsed.advancedLogic || parsed.logicExpression || ''
      };
    }

    if (parsed.status === 'confirm') {
      return {
        ...parsed,
        conditions: normalizeConditions(parsed.conditions),
        advancedLogic: parsed.advancedLogic || parsed.logicExpression || ''
      };
    }

    return parsed;
  }

  function normalizeConditions(conditions) {
    return (Array.isArray(conditions) ? conditions : []).map(condition => ({
      field: String(condition.field || ''),
      operator: String(condition.operator || ''),
      value: String(condition.value || '')
    }));
  }

  function removeLastUserMessage() {
    if (conversationHistory[conversationHistory.length - 1]?.role === 'user') {
      conversationHistory.pop();
    }
  }

  async function processPrompt(userMessage, options = {}) {
    const content = String(userMessage || '').trim();
    if (!content) {
      throw new Error('Prompt is required.');
    }

    ensureSystemMessage();
    conversationHistory.push({ role: 'user', content });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || runtimeConfig.timeoutMs);

    try {
      const requestBody = JSON.stringify({
        model: options.model || runtimeConfig.model,
        messages: conversationHistory,
        response_format: { type: 'json_object' },
        temperature: 0.1
      });

      const response = await fetch(options.webhookUrl || runtimeConfig.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8'
        },
        body: requestBody,
        signal: controller.signal
      });

      const responseText = await response.text();
      const responseData = parseJSON(responseText, `Pipedream returned non-JSON: ${responseText.slice(0, 200) || response.statusText}`);
      const openAIResponse = unwrapOpenAIResponse(responseData);

      if (!response.ok || openAIResponse?.error) {
        throw new Error(openAIResponse?.error?.message || openAIResponse?.message || 'AI API Error');
      }

      const assistantMessage = openAIResponse?.choices?.[0]?.message?.content;
      if (!assistantMessage) {
        throw new Error('Pipedream did not return an OpenAI chat completion response.');
      }

      const parsed = normalizeAssistantResponse(parseJSON(assistantMessage, 'Failed to parse JSON response from AI.'));
      conversationHistory.push({ role: 'assistant', content: JSON.stringify(parsed) });
      return parsed;
    } catch (err) {
      removeLastUserMessage();
      if (err.name === 'AbortError') {
        throw new Error('AI request timed out waiting for Pipedream to respond.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function resetConversation() {
    conversationHistory = [];
  }

  function getConversationHistory() {
    return conversationHistory.slice();
  }

  return {
    configure,
    processPrompt,
    resetConversation,
    getConversationHistory,
    buildSystemPrompt
  };
})();
