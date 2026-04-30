/**
 * whats-new-feed.js
 *
 * Release feed content for Toast Audience Studio - Targeting Studio.
 */
window.WHATS_NEW_FEED = {
  last_updated: "2026-04-30",
  release_notes_url: "https://docs.google.com/document/d/1BN1gHuHyEK3bIkQRiBQp1Sc_sXXHHjbRKq11Y5RuWhc/edit?usp=drive_link",
  max_items_default: 5,
  items: [
    {
      id: "v1.0.0-advanced-logic-ast",
      date: "2026-04-30",
      version: "v1.0.0",
      type: "New",
      title: "Advanced Logic Engine: Full Support for Parentheses",
      summary:
        "The Targeting Studio now features a true logic parser, safely converting grouped conditions (using parentheses) into valid Braze Liquid.",
      details: [
        "Replaced fragile find-and-replace string operations with an AST-based logic compiler.",
        "Parentheses like `1 and (2 or 3)` evaluate exactly as intended without breaking Liquid outputs.",
        "Greatly simplifies multi-regional targeting, VIP cross-selling, and complex exclusions."
      ],
      impact: "All users",
      action_required: false,
      links: [
        {
          label: "Full Release Notes",
          url: "https://docs.google.com/document/d/1BN1gHuHyEK3bIkQRiBQp1Sc_sXXHHjbRKq11Y5RuWhc/edit?usp=drive_link"
        }
      ]
    },
    {
      id: "v0.9.4-contact-type-picklist",
      date: "2026-01-27",
      version: "v0.9.4",
      type: "New", // New | Fix | Change | Deprecation
      title: "Added Contact Type (Comm Category) to Targeting picklist",
      summary:
        "You can now include Contact Type fields in the same query as Location Data so eligibility is evaluated per location_guid.",
      details: [
        "Contact Type fields appear under 'Contact Type (User Attribute)' in the field picker.",
        "Queries can combine catalog filters plus Contact Type in one pass.",
        "This prevents false positives caused by separating Contact Type into native segments."
      ],
      impact: "Campaign Ops, Lifecycle, MOPs",
      action_required: true,
      links: [
        {
          label: "Enablement Guide",
          url: "PASTE_ENABLEMENT_DOC_URL_HERE"
        },
        {
          label: "Full Release Notes",
          url: "https://docs.google.com/document/d/1BN1gHuHyEK3bIkQRiBQp1Sc_sXXHHjbRKq11Y5RuWhc/edit?usp=drive_link"
        }
      ]
    },
    {
      id: "v0.9.3-boolean-handling",
      date: "2026-01-26",
      version: "v0.9.3",
      type: "Fix",
      title: "Fixed boolean handling for catalog and association fields",
      summary:
        "Boolean conditions now evaluate reliably whether values come from the catalog or from location_association_v2.",
      details: [
        "Association booleans compare directly as true or false.",
        "Catalog booleans are coerced from string into <field>_bool before evaluation.",
        "Reduced silent failures where 'true' was treated as a string."
      ],
      impact: "All users",
      action_required: false,
      links: [
        {
          label: "Full Release Notes",
          url: "https://docs.google.com/document/d/1BN1gHuHyEK3bIkQRiBQp1Sc_sXXHHjbRKq11Y5RuWhc/edit?usp=drive_link"
        }
      ]
    },
    {
      id: "v0.9.2-doesnt-contain-multivalue",
      date: "2026-01-24",
      version: "v0.9.2",
      type: "Fix",
      title: "Corrected “Doesn't Contain Any Of” multi-value logic",
      summary:
        "Multi-value negation now generates correct AND-based exclusions instead of an incorrect OR chain.",
      details: [
        "For multi-value lists, the logic now enforces that none of the values are present.",
        "Improves accuracy for product lists and purchased feature strings."
      ],
      impact: "Campaign Ops, Lifecycle",
      action_required: false,
      links: [
        {
          label: "Full Release Notes",
          url: "https://docs.google.com/document/d/1BN1gHuHyEK3bIkQRiBQp1Sc_sXXHHjbRKq11Y5RuWhc/edit?usp=drive_link"
        }
      ]
    },
    {
      id: "v0.9.1-advanced-logic-validation",
      date: "2026-01-22",
      version: "v0.9.1",
      type: "Change",
      title: "Advanced Filter Logic validation and preview improvements",
      summary:
        "Advanced logic input is now validated for parentheses and filter numbering, with clearer preview output.",
      details: [
        "Invalid expressions show a warning directly in the Advanced Logic section.",
        "Query Preview now shows each rule’s data source as Catalog or User Attr."
      ],
      impact: "All users",
      action_required: false,
      links: [
        {
          label: "Full Release Notes",
          url: "https://docs.google.com/document/d/1BN1gHuHyEK3bIkQRiBQp1Sc_sXXHHjbRKq11Y5RuWhc/edit?usp=drive_link"
        }
      ]
    },
    {
      id: "v0.9.0-qa-webhook-evidence",
      date: "2026-01-20",
      version: "v0.9.0",
      type: "New",
      title: "Introduced QA Webhook output for eligibility evidence stamping",
      summary:
        "A QA Webhook template is available to stamp matched location evidence onto the user profile with strict whitespace control.",
      details: [
        "Outputs matched_locations as structured JSON for debugging and audits.",
        "Includes key catalog fields and association flags for each matched location.",
        "Adds no_match_reason when no eligible location exists."
      ],
      impact: "MOPs, QA, Lifecycle",
      action_required: false,
      links: [
        {
          label: "Enablement Guide",
          url: "PASTE_ENABLEMENT_DOC_URL_HERE"
        },
        {
          label: "Full Release Notes",
          url: "https://docs.google.com/document/d/1BN1gHuHyEK3bIkQRiBQp1Sc_sXXHHjbRKq11Y5RuWhc/edit?usp=drive_link"
        }
      ]
    }
  ]
};
