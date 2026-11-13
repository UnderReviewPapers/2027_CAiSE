// =====================================================================
// Methodology data, mirroring the conceptual model of the paper.
//   Stage, Criterion, Alternative (+ Characteristic, Resource,
//   Expected Performance), Question / Answer Option -> Design Requirement
//   (Hard Constraint | Preference) and Resource, Scenario presets.
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

// ---------- Resources ----------
const RESOURCES = {
  histories: { name: 'Interaction histories',              kind: 'data' },
  catalogue: { name: 'Item catalogue with attributes',     kind: 'data' },
  host_slm:  { name: 'Hardware to host an SLM internally', kind: 'computational' },
  host_llm:  { name: 'Hardware to host an LLM internally', kind: 'computational' }
};

// ---------- Language models used by the framework ----------
const LANGUAGE_MODELS = {
  slm: { id: 'mistral.ministral-3-8b-instruct', name: 'Ministral-3-8B' },
  llm: { id: 'openai.gpt-oss-120b',             name: 'GPT-OSS-120B' }
};

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
      requires: deployment === 'internal' && type !== 'traditional' ? ['host_' + type] : [],
      model: LANGUAGE_MODELS[type] || null
    });
  }
}

// Expected-performance provenance (conceptual model): all values are the
// designer's estimates from the Excel workbook, before any execution.
const PROVENANCE = {
  traditional: 'Estimated (Excel workbook)',
  'slm-direct': 'Estimated (Excel workbook)',
  'llm-direct': 'Estimated (Excel workbook)',
  'llm-agentic': 'Estimated (Excel workbook)'
};

// Stage-specific part of each alternative.
//   technique / component / capabilities: by execution style (traditional | direct | agentic)
//   requires: extra resources by execution style
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
    requires: { agentic: ['catalogue'] },
    est: {
      intent:   ['L',  'M', 'H', 'VH'],
      accuracy: ['VH', 'L', 'M', 'M'],
      time:     ['VH', 'H', 'M', 'L'],
      cost:     ['VH', 'M', 'M', 'L']
    },
    rationale: {
      intent: 'Rules recognise only anticipated patterns. The SLM interprets free-form requests with limited reasoning; the LLM interprets them better. Agents can also link the mentioned items to the catalogue.',
      accuracy: 'Rules are deterministic and always produce a well-formed output. LM outputs vary, the SLM more than the LLM. Agents add reasoning steps but ground the representation on the catalogue.',
      time: 'No model invocation for rules. Response time grows with model size and with the number of invocations of agents.',
      cost: 'No tokens for rules. SLM and LLM consume similar tokens for the same request. Agents perform several invocations.'
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
    requires: { traditional: ['histories', 'catalogue'], agentic: ['catalogue'] },
    params: { n_candidates: 20 },
    est: {
      intent:    ['VL', 'M',  'H', 'VH'],
      accuracy:  ['VH', 'L',  'M', 'H'],
      grounding: ['VH', 'VL', 'L', 'H'],
      time:      ['VH', 'H',  'M', 'L'],
      cost:      ['VH', 'M',  'M', 'L']
    },
    rationale: {
      intent: 'ALS requires a history and the attribute filter depends on the attributes extracted from the request. Direct LMs can propose items similar to a reference without shared attributes. Agents combine interpretation with iterative catalogue queries.',
      accuracy: 'Traditional retrieval is deterministic. Generated candidates vary, the SLM more than the LLM. Agents retrieve real items that match their queries.',
      grounding: 'Traditional techniques return only catalogue items. Direct LMs generate items without accessing the catalogue. Agents retrieve items through queries but may rewrite them.',
      time: 'As in input processing; LM alternatives may also retry when their output cannot be parsed.',
      cost: 'As in input processing.'
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
    requires: { traditional: ['catalogue'], agentic: ['catalogue'] },
    est: {
      intent:    ['VL', 'M', 'H', 'H'],
      accuracy:  ['VH', 'L', 'M', 'M'],
      grounding: ['VH', 'M', 'M', 'H'],
      time:      ['VH', 'H', 'M', 'L'],
      cost:      ['VH', 'M', 'M', 'L']
    },
    rationale: {
      intent: 'Ratings and popularity do not depend on the subjective request. LMs judge relevance against the interpreted request; further attributes retrieved by agents add little.',
      accuracy: 'As in input processing.',
      grounding: 'Traditional scoring keeps the identifiers. Direct LMs rewrite the list, so identifiers may change. Agents can check items against the catalogue.',
      time: 'LMs process every candidate; agents multiply invocations.',
      cost: 'As response time.'
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
    requires: { agentic: ['catalogue'] },
    params: { top_k: 10 },
    est: {
      intent:    ['L',  'M', 'M', 'M'],
      accuracy:  ['VH', 'L', 'L', 'L'],
      grounding: ['VH', 'M', 'M', 'M'],
      time:      ['VH', 'H', 'M', 'L'],
      cost:      ['VH', 'M', 'M', 'L']
    },
    rationale: {
      intent: 'Sorting preserves the relevance computed in scoring but adds no interpretation. LMs can account for contextual factors, but receive only score and a few attributes.',
      accuracy: 'Sorting is deterministic. LM ranking may change with the order in which candidates are presented.',
      grounding: 'Sorting keeps the identifiers. LMs rewrite the list, so identifiers may change.',
      time: 'As in input processing.',
      cost: 'As in input processing.'
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
    requires: { agentic: ['catalogue'] },
    est: {
      engagement: ['VL', 'M', 'H', 'VH'],
      accuracy:   ['VH', 'L', 'M', 'H'],
      grounding:  ['VH', 'M', 'M', 'H'],
      time:       ['VH', 'H', 'M', 'L'],
      cost:       ['VH', 'M', 'M', 'L']
    },
    rationale: {
      engagement: 'Templates cannot adapt to the user or the conversation. LMs generate personalised explanations and clarification questions, the LLM better than the SLM. Agents can retrieve further attributes for a more complete response.',
      accuracy: 'Templates are always faithful to the ranked list. LM responses vary, the SLM more than the LLM. Agents can check the items they mention.',
      grounding: 'Templates use only the ranked items. Direct LMs may mention items outside the list. Agents can verify them against the catalogue.',
      time: 'As in input processing.',
      cost: 'As in input processing.'
    }
  }
};

const CAPABILITIES = {
  freeform: 'Free-form request interpretation',
  catalogue_access: 'Catalogue access (tools)',
  explanations: 'Natural-language explanations'
};

// ---------- Questions (Scenario characterisation) ----------
// Each answer option may imply:
//   constraints: [{ stages: [...] | [] (=pipeline), requires: {dimension|capability: value}, text }]
//   preferences: { criterionId: 'High' | 'Medium' | 'Low' }
//   resources:   [resourceId, ...]
// DRAFT: wording and mappings still to be validated.
const QUESTION_GROUPS = [
  { id: 'purpose',  name: 'Recommendation purpose and user interaction' },
  { id: 'data',     name: 'Available data and resources' },
  { id: 'privacy',  name: 'Restrictions on data processing' },
  { id: 'ops',      name: 'Operational conditions' }
];

const ALL_STAGES = STAGES.map(s => s.id);

const QUESTIONS = [
  { id: 'interaction', group: 'purpose',
    text: 'What type of interaction must the system support?',
    options: [
      { id: 'structured', text: 'Predefined attributes (filters, forms)', preferences: { intent: 'Low' } },
      { id: 'freeform', text: 'Free-form natural language, within a known domain',
        constraints: [{ stages: ['input'], requires: { capability: 'freeform' }, text: 'Input processing must interpret free-form requests' }],
        preferences: { intent: 'Medium' } },
      { id: 'unconstrained', text: 'Unconstrained free-form interaction, including subjective or implicit requests',
        constraints: [{ stages: ['input'], requires: { capability: 'freeform' }, text: 'Input processing must interpret free-form requests' }],
        preferences: { intent: 'High' } }
    ] },
  { id: 'consequence', group: 'purpose',
    text: 'What are the consequences of an unsuitable recommendation?',
    options: [
      { id: 'limited', text: 'Limited: the user can simply ask again', preferences: { engagement: 'High', accuracy: 'Medium' } },
      { id: 'serious', text: 'Serious: users may rely on it for important decisions', preferences: { engagement: 'Low', accuracy: 'High' } }
    ] },
  { id: 'histories', group: 'data',
    text: 'Are user interaction histories available?',
    options: [
      { id: 'all',  text: 'Yes, for all users', resources: ['histories'] },
      { id: 'part', text: 'Only for part of the users', resources: ['histories'] },
      { id: 'none', text: 'No' }
    ] },
  { id: 'catalogue', group: 'data',
    text: 'Must recommendations refer to a catalogue of items?',
    options: [
      { id: 'mandatory', text: 'Yes, only verified catalogue items may be recommended', resources: ['catalogue'],
        constraints: [{ stages: ['candidates'], requires: { capability: 'catalogue_access' }, text: 'Candidate selection must retrieve items from the catalogue' }],
        preferences: { grounding: 'High' } },
      { id: 'preferred', text: 'Preferably, unavailable items degrade the experience', resources: ['catalogue'], preferences: { grounding: 'Medium' } },
      { id: 'no', text: 'No catalogue', preferences: { grounding: 'Low' } }
    ] },
  { id: 'infra', group: 'data',
    text: 'Which infrastructure is available to host language models internally?',
    options: [
      { id: 'none', text: 'None' },
      { id: 'slm',  text: 'Hardware able to host a small LM', resources: ['host_slm'] },
      { id: 'llm',  text: 'Hardware able to host small and large LMs', resources: ['host_slm', 'host_llm'] }
    ] },
  { id: 'external', group: 'privacy',
    text: 'May user data be processed by external services?',
    options: [
      { id: 'yes', text: 'Yes, no sensitive data are processed' },
      { id: 'no',  text: 'No, identifiable user data must stay within the organisation',
        constraints: [{ stages: ALL_STAGES, requires: { deployment: 'internal' }, text: 'Every stage processing user data must be deployed internally' }] }
    ] },
  { id: 'time', group: 'ops',
    text: 'Is additional response time acceptable in exchange for a richer interaction?',
    options: [
      { id: 'yes',     text: 'Yes',              preferences: { time: 'Low' } },
      { id: 'limited', text: 'Within limits',    preferences: { time: 'Medium' } },
      { id: 'no',      text: 'No, it must be fast', preferences: { time: 'High' } }
    ] },
  { id: 'cost', group: 'ops',
    text: 'Is additional inference cost acceptable?',
    options: [
      { id: 'yes',     text: 'Yes',           preferences: { cost: 'Low' } },
      { id: 'limited', text: 'Within limits', preferences: { cost: 'Medium' } },
      { id: 'no',      text: 'No',            preferences: { cost: 'High' } }
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
    answers: { interaction: 'unconstrained', consequence: 'limited', histories: 'part', catalogue: 'preferred',
               infra: 'slm', external: 'yes', time: 'yes', cost: 'yes' }
  },
  healthcare: {
    name: 'Healthcare recommendation',
    description: 'A healthcare organisation provides a conversational assistant that recommends educational resources to patients.',
    example: 'I was recently diagnosed with type 2 diabetes. Can you recommend a reliable, easy-to-understand guide about healthy eating and physical activity?',
    context: { project: 'Patient education assistant', domain: 'Healthcare', items: 'Educational resources validated by the organisation',
               users: 'Patients of the healthcare organisation' },
    answers: { interaction: 'freeform', consequence: 'serious', histories: 'part', catalogue: 'mandatory',
               infra: 'slm', external: 'no', time: 'limited', cost: 'limited' }
  }
};
