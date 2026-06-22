/**
 * builder-config.js
 *
 * Static builder configuration for Toast Audience Studio - Targeting Studio.
 */
window.BUILDER_CONFIG = {
  defaultCondition: { id: 1, field: 'account_segment', operator: 'equals', value: 'SMB' },
  locationsAttr: 'locations_v2',
  associationAttr: 'location_association_v2',
  catalogName: 'Primary_Locations_Catalog',
  operatorsByType: {
    string: {
      equals: { liquid: '==', label: 'Equals' },
      does_not_equal: { liquid: '!=', label: 'Does Not Equal' },
      is_any_of: { liquid: 'is_any_of', label: 'Is Any Of', multiValue: true, supportsBulk: true },
      is_none_of: { liquid: 'is_none_of', label: 'Is None Of', multiValue: true, supportsBulk: true },
      contains_any_of: { liquid: 'contains_any_of', label: 'Contains Any Of', multiValue: true, supportsBulk: true },
      doesnt_contain_any_of: { liquid: 'doesnt_contain_any_of', label: "Doesn't Contain Any Of", multiValue: true, supportsBulk: true },
      is_not_blank: { liquid: 'is_not_blank', label: 'Is Not Blank', noValue: true },
      is_blank: { liquid: 'is_blank', label: 'Is Blank', noValue: true }
    },
    number: {
      exactly: { liquid: '==', label: 'Exactly' },
      does_not_equal: { liquid: '!=', label: 'Does Not Equal' },
      more_than: { liquid: '>', label: 'More Than' },
      less_than: { liquid: '<', label: 'Less Than' },
      more_than_or_equal: { liquid: '>=', label: 'More Than or Equal' },
      less_than_or_equal: { liquid: '<=', label: 'Less Than or Equal' },
      between: { liquid: 'between', label: 'Between', rangeValue: true },
      is_not_blank: { liquid: 'is_not_blank', label: 'Is Not Blank', noValue: true },
      is_blank: { liquid: 'is_blank', label: 'Is Blank', noValue: true }
    },
    boolean: {
      is_true: { liquid: '== true', label: 'Is True', noValue: true },
      is_false: { liquid: '== false', label: 'Is False', noValue: true },
      is_true_or_not_set: { liquid: 'is_true_or_not_set', label: 'Is True or Not Set', noValue: true },
      is_false_or_not_set: { liquid: 'is_false_or_not_set', label: 'Is False or Not Set', noValue: true },
      is_not_blank: { liquid: 'is_not_blank', label: 'Is Not Blank', noValue: true },
      is_blank: { liquid: 'is_blank', label: 'Is Blank', noValue: true }
    },
    datetime: {
      before: { liquid: '<', label: 'Before' },
      after: { liquid: '>', label: 'After' },
      on: { liquid: '==', label: 'On' },
      before_or_on: { liquid: '<=', label: 'Before or On' },
      after_or_on: { liquid: '>=', label: 'After or On' },
      between_dates: { liquid: 'between', label: 'Between Dates', rangeValue: true },
      more_than_days_ago: { liquid: 'more_than_days_ago', label: 'More Than X Days Ago', preset: true },
      less_than_days_ago: { liquid: 'less_than_days_ago', label: 'Less Than X Days Ago', preset: true },
      more_than_days_in_future: { liquid: 'more_than_days_in_future', label: 'More Than X Days in Future', preset: true },
      less_than_days_in_future: { liquid: 'less_than_days_in_future', label: 'Less Than X Days in Future', preset: true },
      is_not_blank: { liquid: 'is_not_blank', label: 'Is Not Blank', noValue: true },
      is_blank: { liquid: 'is_blank', label: 'Is Blank', noValue: true }
    }
  }
};
