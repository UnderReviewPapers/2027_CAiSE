// =====================================================================
// Design data, mirroring the conceptual model of the paper.
//   Stage, Criterion, Alternative (+ Characteristics, Expected Performance),
//   Question / Answer Option -> Design Requirement (Hard Constraint | Preference),
//   Context and scenario presets.
// Everything the demo shows comes from this file: edit here, not in app.js.
// =====================================================================

// ---------- Stages (Section "Design Space") ----------
const STAGES = [
  { id: 'input', name: 'Input processing',
    task: 'Identifies task, preferences and constraints', output: 'request representation',
    traditional: 'Predefined rules, intent classification, entity extraction',
    capabilities: 'Interpret free-form requests and subjective preferences',
    limitations: 'Incorrect assumptions; privacy constraints when processing sensitive requests' },
  { id: 'candidates', name: 'Candidate selection',
    task: 'Identifies potentially relevant items', output: 'candidate set',
    traditional: 'Collaborative filtering, content-based retrieval, attribute filtering, knowledge-based approaches',
    capabilities: 'Semantic retrieval, structured queries, tool use or direct candidate generation; unstructured information',
    limitations: 'Directly generated items may fall outside the catalogue' },
  { id: 'scoring', name: 'Scoring',
    task: 'Estimates relevance to the request', output: 'scored candidates',
    traditional: 'Similarity measures, predicted ratings, specialised learning models',
    capabilities: 'Assess relevance through semantic relationships between requests and item descriptions',
    limitations: 'Potentially higher response time and cost; sensitivity to prompting' },
  { id: 'ranking', name: 'Ranking',
    task: 'Orders candidates', output: 'ranked list',
    traditional: 'Score-based or predefined ranking strategies',
    capabilities: 'Compare candidates using contextual preferences and relationships',
    limitations: 'Sensitivity to candidate presentation order' },
  { id: 'response', name: 'Response generation',
    task: 'Presents recommendations', output: 'response to the user',
    traditional: 'Predefined templates',
    capabilities: 'Generate explanations adapted to the request; support engagement',
    limitations: 'Unsupported information or references to items not selected by previous stages' }
];

// ---------- Design-space dimensions ----------
const DIMENSIONS = {
  type:       { label: 'Component type', values: { traditional: 'Traditional', slm: 'SLM', llm: 'LLM' } },
  deployment: { label: 'Deployment',     values: { internal: 'Internal', external: 'External' } },
  execution:  { label: 'Execution',      values: { direct: 'Direct', agentic: 'Agentic' } }
};

// ---------- Criteria ----------
// All estimates use a "higher is better" scale, so direction is already
// accounted for (e.g. a high response-time level means a FAST component).
// Names follow the paper; the Excel sheet used older names
// (Task flexibility -> Intent recognition, Reliability -> Accuracy, Latency -> Response time).
const CRITERIA = [
  { id: 'intent',     name: 'Intent recognition',  family: 'Interaction quality',    direction: 'max' },
  { id: 'engagement', name: 'Engagement',          family: 'Interaction quality',    direction: 'max' },
  { id: 'accuracy',   name: 'Accuracy',            family: 'Recommendation quality', direction: 'max' },
  { id: 'grounding',  name: 'Catalogue grounding', family: 'Recommendation quality', direction: 'max' },
  { id: 'time',       name: 'Response time',       family: 'Operational',            direction: 'min' },
  { id: 'cost',       name: 'Cost',                family: 'Operational',            direction: 'min' }
];

// Criteria each stage influences (alternatives of a stage are compared only on these).
const STAGE_CRITERIA = {
  input:      ['intent', 'accuracy', 'time', 'cost'],
  candidates: ['intent', 'accuracy', 'grounding', 'time', 'cost'],
  scoring:    ['intent', 'accuracy', 'grounding', 'time', 'cost'],
  ranking:    ['intent', 'accuracy', 'grounding', 'time', 'cost'],
  response:   ['engagement', 'accuracy', 'grounding', 'time', 'cost']
};

// Estimate scale and priority weights (from the Excel workbook).
const LEVELS  = { VL: 0.1, L: 0.3, M: 0.5, H: 0.7, VH: 0.9 };
const LEVEL_NAMES = { VL: 'Very low', L: 'Low', M: 'Medium', H: 'High', VH: 'Very high' };
const WEIGHTS = { High: 3, Medium: 2, Low: 1 };

// ---------- Required resources ----------
// Values of the "Required resource" characteristic of an alternative.
// Answers that declare a resource unavailable produce a hard constraint
// excluding the alternatives that require it (checked in alternative identification).
const REQUIRED_RESOURCES = {
  histories:  { name: 'Interaction histories',       kind: 'data' },
  attributes: { name: 'Structured item attributes',  kind: 'data' },
  ratings:    { name: 'Item ratings',                kind: 'data' },
  host_slm:   { name: 'Hardware to host an SLM',     kind: 'computational' },
  host_llm:   { name: 'Hardware to host an LLM',     kind: 'computational' }
};

// ---------- Language models used by the framework ----------
// An LM-based alternative can use any language model of its type (selected in configuration selection).
const LANGUAGE_MODELS = [
  { id: 'mistral.ministral-3-8b-instruct', name: 'Ministral-3-8B', type: 'slm' },
  { id: 'openai.gpt-oss-120b',             name: 'GPT-OSS-120B',   type: 'llm' }
  // TODO: further models supported by the framework.
];

// ---------- Alternatives ----------
// The design space is type x deployment x execution. A "variant" is
// type + execution; each variant is available with internal or external deployment.
// Only the variants implemented in the framework are listed:
// traditional + agentic makes no sense, and SLM agentic is not implemented yet.
//   -> 4 variants x 2 deployments = 8 alternatives per stage.
//
// Deployment does not change the expected performance (in the experiments all
// models are served from the same infrastructure); it matters for privacy
// constraints and required resources.
const VARIANTS = ['traditional', 'slm-direct', 'llm-direct', 'llm-agentic'];

const ALTERNATIVE_KINDS = [];
for (const variant of VARIANTS) {
  const [type, execution = 'direct'] = variant.split('-');
  for (const deployment of ['internal', 'external']) {
    ALTERNATIVE_KINDS.push({
      kind: `${variant}-${deployment}`,
      variant, type, execution, deployment,
      // Hosting an LM internally needs suitable hardware.
      requiredResources: deployment === 'internal' && type !== 'traditional' ? ['host_' + type] : [],
      models: LANGUAGE_MODELS.filter(m => m.type === type),   // compatible language models
      model: LANGUAGE_MODELS.find(m => m.type === type) || null // default one
    });
  }
}

// Provenance of the expected performance (conceptual model): how a value was obtained.
// Before any execution all values are estimated. After an execution, response time and cost of the executed
// alternatives are measured; the designer may revise the other estimates in the light of the results.
const PROVENANCE = {
  Estimated: 'Expert judgement of the designer, on the qualitative scale VL–VH',
  Revised:   'Estimate revised by the designer in the light of execution results',
  Measured:  'Measured in an execution of the configuration, normalised'
};

// Stage-specific part of each alternative.
//   technique / component / capabilities: by execution style (traditional | direct | agentic)
//   requiredResources: further required resources by execution style
//   params: default parameters of the framework component, by execution style
//   est: Expected Performance levels, ordered as VARIANTS
//        [traditional, slm-direct, llm-direct, llm-agentic]
const STAGE_ALTERNATIVES = {
  input: {
    technique: {
      traditional: 'Rule-based concept extraction',
      direct: 'The LM interprets the request',
      agentic: 'The LM interprets the request and links mentioned items to the catalogue (Text-to-SQL)'
    },
    component: { traditional: 'input_parser.rule_based', direct: 'input_parser.llm', agentic: 'input_parser.agent' },
    capabilities: { traditional: [], direct: ['freeform'], agentic: ['freeform', 'catalogue_access'] },
    requiredResources: { agentic: ['attributes'] },   // Text-to-SQL on the catalogue
    est: {
      intent:   ['L',  'M', 'H', 'VH'],
      accuracy: ['VH', 'L', 'M', 'M'],
      time:     ['VH', 'H', 'M', 'L'],
      cost:     ['VH', 'M', 'M', 'L']
    }
  },
  candidates: {
    technique: {
      traditional: 'ALS collaborative filtering with attribute-based filtering',
      direct: "The LM generates items from its own knowledge, without catalogue access",
      agentic: 'The LM queries the catalogue (Text-to-SQL) and refines the query'
    },
    component: { traditional: 'generator.traditional', direct: 'generator.llm', agentic: 'generator.agent' },
    capabilities: { traditional: ['catalogue_access'], direct: [], agentic: ['catalogue_access'] },
    // ALS with attribute filtering falls back on the filter for users without a history,
    // so it does not require interaction histories (pure ALS would).
    requiredResources: { traditional: ['attributes'], agentic: ['attributes'] },
    // Default parameters by execution style (the traditional generator has none).
    params: { direct: { n_candidates: 20 }, agentic: { n_candidates: 20 } },
    est: {
      intent:    ['VL', 'M',  'H', 'VH'],
      accuracy:  ['VH', 'L',  'M', 'H'],
      grounding: ['VH', 'VL', 'L', 'H'],
      time:      ['VH', 'H',  'M', 'L'],
      cost:      ['VH', 'M',  'M', 'L']
    }
  },
  scoring: {
    technique: {
      traditional: 'Combination of ratings and popularity',
      direct: 'The LM estimates relevance from the attributes of each candidate',
      agentic: 'The LM estimates relevance and can retrieve further attributes'
    },
    component: { traditional: 'scorer.traditional', direct: 'scorer.llm', agentic: 'scorer.agent' },
    capabilities: { traditional: [], direct: [], agentic: ['catalogue_access'] },
    requiredResources: { traditional: ['ratings'], agentic: ['attributes'] },
    est: {
      intent:    ['VL', 'M', 'H', 'H'],
      accuracy:  ['VH', 'L', 'M', 'M'],
      grounding: ['VH', 'M', 'M', 'H'],
      time:      ['VH', 'H', 'M', 'L'],
      cost:      ['VH', 'M', 'M', 'L']
    }
  },
  ranking: {
    technique: {
      traditional: 'Sorting by score',
      direct: 'The LM orders candidates from score and attributes',
      agentic: 'The LM orders candidates and can retrieve further attributes'
    },
    component: { traditional: 'ranker.traditional', direct: 'ranker.llm', agentic: 'ranker.agent' },
    capabilities: { traditional: [], direct: [], agentic: ['catalogue_access'] },
    requiredResources: { agentic: ['attributes'] },
    params: { traditional: { top_k: 10 }, direct: { top_k: 10 }, agentic: { top_k: 10 } },
    est: {
      intent:    ['L',  'M', 'M', 'M'],
      accuracy:  ['VH', 'L', 'L', 'L'],
      grounding: ['VH', 'M', 'M', 'M'],
      time:      ['VH', 'H', 'M', 'L'],
      cost:      ['VH', 'M', 'M', 'L']
    }
  },
  response: {
    technique: {
      traditional: 'Templates',
      direct: 'The LM generates the response from the ranked list',
      agentic: 'The LM generates the response and can retrieve further attributes'
    },
    component: { traditional: 'output_generator.simple_response', direct: 'output_generator.llm', agentic: 'output_generator.agent' },
    capabilities: { traditional: [], direct: ['explanations'], agentic: ['explanations', 'catalogue_access'] },
    requiredResources: { agentic: ['attributes'] },
    est: {
      engagement: ['VL', 'M', 'H', 'VH'],
      accuracy:   ['VH', 'L', 'M', 'H'],
      grounding:  ['VH', 'M', 'M', 'H'],
      time:       ['VH', 'H', 'M', 'L'],
      cost:       ['VH', 'M', 'M', 'L']
    }
  }
};

const CAPABILITIES = {
  freeform: 'Free-form request interpretation',
  catalogue_access: 'Catalogue access (tools)',
  explanations: 'Natural-language explanations'
};

// ---------- Framework configuration file ----------
// Fixed parts of the file read by the framework (framework/config/schema.yaml).
// The orchestrator answers information requests and fallbacks with the selected response generator.
const FRAMEWORK_CONFIG = {
  fileName: 'schema.yaml',
  state: 'state.simple',
  userModel: 'user_model.simple',
  orchestrator: 'orchestrator.sequential_traditional_fb'
};

// ---------- Questions (Scenario characterisation) ----------
// Each question addresses one criterion or one constraint. An answer option may imply:
//   preferences: { criterionId: 'High' | 'Medium' | 'Low' }
//   constraints: hard constraints. Stage-level ones are checked in alternative identification:
//     { stages, requires: { capability | dimension: value }, text }
//         the alternatives of those stages must have the characteristic
//     { unavailable: resourceId, text }
//         no alternative may require the resource
//     { stages, criterion, min: level, text }
//         threshold: expected performance on the criterion at least the level (none used yet)
//   The pipeline-level one is checked in configuration selection, on the complete configuration:
//     { pipeline: 'time', max: seconds, text }
//   verify: { measure, max } (optional) - how the constraint is verified on the measured values after
//     execution, when the characteristic checked at design time only approximates it.
const QUESTION_GROUPS = [
  { id: 'purpose',  name: 'Recommendation purpose and user interaction' },
  { id: 'data',     name: 'Available data and resources' },
  { id: 'privacy',  name: 'Restrictions on data processing' },
  { id: 'ops',      name: 'Operational conditions' }
];

const ALL_STAGES = STAGES.map(s => s.id);

const FREEFORM = { stages: ['input'], requires: { capability: 'freeform' }, text: 'Alternatives must interpret free-form requests' };
const NO_HISTORIES = { unavailable: 'histories', text: 'No alternative may require interaction histories' };
const NO_ATTRIBUTES = { unavailable: 'attributes', text: 'No alternative may require structured item attributes' };
const NO_RATINGS = { unavailable: 'ratings', text: 'No alternative may require item ratings' };
const NO_SLM_HOST = { unavailable: 'host_slm', text: 'No alternative may require hardware to host an SLM' };
const NO_LLM_HOST = { unavailable: 'host_llm', text: 'No alternative may require hardware to host an LLM' };
const maxTime = s => ({ pipeline: 'time', max: s, text: `Response time of the pipeline at most ${s} s` });

const QUESTIONS = [
  // --- Recommendation purpose and user interaction ---
  { id: 'interaction', group: 'purpose',
    text: 'What type of interaction must the system support?',
    options: [
      { id: 'predefined', text: 'Predefined attributes, selected or explicitly stated', preferences: { intent: 'Low' } },
      { id: 'freeform', text: 'Free-form requests, including indirect needs (e.g. a mood)',
        preferences: { intent: 'Medium' }, constraints: [FREEFORM] },
      { id: 'unconstrained', text: 'Unconstrained free-form requests, including references to other items',
        preferences: { intent: 'High' }, constraints: [FREEFORM] }
    ] },
  { id: 'presentation', group: 'purpose',
    text: 'How must the system present its recommendations?',
    options: [
      { id: 'fixed',       text: 'Only the recommended items, in a fixed format',   preferences: { engagement: 'Low' } },
      { id: 'description', text: 'Items with a clear description in natural language', preferences: { engagement: 'Medium' } },
      { id: 'engaging',    text: 'An engaging response in a conversational tone',   preferences: { engagement: 'High' } }
    ] },
  { id: 'impact', group: 'purpose',
    text: 'What is the impact of incorrect or unsuitable recommendations?',
    options: [
      { id: 'negligible', text: 'Negligible, as they are simply ignored',        preferences: { accuracy: 'Low' } },
      { id: 'limited',    text: 'Limited, such as wasted time or reduced trust', preferences: { accuracy: 'Medium' } },
      { id: 'serious',    text: 'Serious, as users may rely on them',            preferences: { accuracy: 'High' } }
    ] },
  { id: 'catalogue', group: 'purpose',
    text: 'Must recommended items belong to the catalogue?',
    options: [
      { id: 'no',         text: 'No, other items are still useful',          preferences: { grounding: 'Low' } },
      { id: 'preferably', text: 'Preferably, other items are of little use', preferences: { grounding: 'Medium' } },
      { id: 'strongly',   text: 'Strongly, other items would mislead users', preferences: { grounding: 'High' } },
      { id: 'mandatory',  text: 'Mandatory, only catalogue items are allowed', preferences: { grounding: 'High' },
        constraints: [{ stages: ['candidates'], requires: { capability: 'catalogue_access' }, text: 'Only catalogue items may be recommended',
                        verify: { measure: 'notMatched', max: 0 } }] }
    ] },

  // --- Available data and resources ---
  { id: 'histories', group: 'data',
    text: 'Are user interaction histories available?',
    options: [
      { id: 'all',  text: 'Yes, for all users' },
      { id: 'part', text: 'Only for part of the users', constraints: [NO_HISTORIES] },
      { id: 'none', text: 'No', constraints: [NO_HISTORIES] }
    ] },
  { id: 'catalogue_info', group: 'data',
    text: 'What information does the catalogue provide?',
    options: [
      { id: 'names',      text: 'Item names and descriptions only', constraints: [NO_ATTRIBUTES, NO_RATINGS] },
      { id: 'attributes', text: 'Structured attributes (e.g. genre, year)', constraints: [NO_RATINGS] },
      { id: 'ratings',    text: 'Structured attributes and user ratings' }
    ] },
  { id: 'infra', group: 'data',
    text: 'What infrastructure is available to host language models internally?',
    options: [
      { id: 'none', text: 'None', constraints: [NO_SLM_HOST, NO_LLM_HOST] },
      { id: 'slm',  text: 'Hardware for small language models', constraints: [NO_LLM_HOST] },
      { id: 'llm',  text: 'Hardware for large language models as well' }
    ] },

  // --- Restrictions on data processing ---
  { id: 'sensitive', group: 'privacy',
    text: 'May sensitive data be processed by external services?',
    options: [
      { id: 'none',     text: 'No sensitive data are involved' },
      { id: 'allowed',  text: 'Yes, external processing is allowed' },
      { id: 'internal', text: 'No, sensitive data must remain internal',
        constraints: [{ stages: ALL_STAGES, requires: { deployment: 'internal' }, text: 'Alternatives must be deployed internally' }] }
    ] },

  // --- Operational conditions ---
  { id: 'speed', group: 'ops',
    text: 'How quickly must the system respond?',
    options: [
      { id: 'immediate', text: 'Immediately',          preferences: { time: 'High' } },
      { id: 'seconds',   text: 'Within a few seconds', preferences: { time: 'Medium' } },
      { id: 'longer',    text: 'Longer waits are acceptable, up to tens of seconds', preferences: { time: 'Low' } }
    ] },
  { id: 'max_time', group: 'ops',
    text: 'Is there a maximum acceptable response time?',
    options: [
      { id: 'no',  text: 'No' },
      { id: 's5',  text: 'Yes, 5 seconds',  constraints: [maxTime(5)] },
      { id: 's10', text: 'Yes, 10 seconds', constraints: [maxTime(10)] },
      { id: 's30', text: 'Yes, 30 seconds', constraints: [maxTime(30)] }
    ] },
  { id: 'budget', group: 'ops',
    text: 'How constrained is the budget per request?',
    options: [
      { id: 'tight',    text: 'Tight, cost must be kept minimal',           preferences: { cost: 'High' } },
      { id: 'moderate', text: 'Moderate, limited increases are acceptable', preferences: { cost: 'Medium' } },
      { id: 'flexible', text: 'Flexible, higher costs are acceptable',      preferences: { cost: 'Low' } }
    ] }
];

// ---------- Scenario presets (Section "Motivating Scenarios") ----------
// Context of a design (paper: the Context identifies the application domain).
// These fields describe the application; they do not influence the comparison.
const CONTEXT_FIELDS = [
  { id: 'project', label: 'Project name', placeholder: 'e.g. Movie assistant' },
  { id: 'domain',  label: 'Application domain', placeholder: 'e.g. Movies, healthcare, e-commerce' },
  { id: 'items',   label: 'Recommended items', placeholder: 'e.g. Movies from the HetRec catalogue' },
  { id: 'users',   label: 'Target users', placeholder: 'e.g. Subscribers of a streaming platform' },
  { id: 'description', label: 'Description', placeholder: 'What the recommender system is for', long: true },
  { id: 'example', label: 'Example request', placeholder: 'A typical request the system must handle', long: true }
];

const SCENARIOS = {
  movie: {
    name: 'Movie recommendation',
    description: 'A streaming platform provides a conversational assistant that helps users discover movies.',
    example: 'Toy Story is great, but maybe something with the same vibe for an older audience?',
    context: { project: 'Movie assistant', domain: 'Movies', items: 'Movies from the HetRec catalogue',
               users: 'Subscribers of a streaming platform' },
    answers: { interaction: 'unconstrained', presentation: 'engaging', impact: 'limited', catalogue: 'preferably',
               histories: 'part', catalogue_info: 'ratings', infra: 'slm', sensitive: 'none',
               speed: 'longer', max_time: 'no', budget: 'flexible' },
    // Configuration selection of the paper: the designer follows the ranking except for scoring.
    selections: { scoring: 'llm-direct-external' },
    rationale: {
      scoring: 'Popularity ignores the request; agentic access adds time and cost without new information.'
    }
  },
  healthcare: {
    name: 'Healthcare recommendation',
    description: 'A healthcare organisation provides a conversational assistant that recommends educational resources to patients.',
    example: 'I was recently diagnosed with type 2 diabetes. Can you recommend a reliable, easy-to-understand guide about healthy eating and physical activity?',
    context: { project: 'Patient education assistant', domain: 'Healthcare', items: 'Educational resources validated by the organisation',
               users: 'Patients of the healthcare organisation' },
    // TODO: healthcare answers still to be reviewed.
    answers: { interaction: 'freeform', presentation: 'description', impact: 'serious', catalogue: 'mandatory',
               histories: 'part', catalogue_info: 'ratings', infra: 'slm', sensitive: 'internal',
               speed: 'seconds', max_time: 'no', budget: 'moderate' }
  }
};
