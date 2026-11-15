// =====================================================================
// Execution results (Evaluation Evidence), used by execution feedback.
// Each execution records the configuration that was run and the measured
// values, with the sample size on which they are computed. All values refer
// to the movie scenario (9 queries) and are valid only in that context.
//
// role: 'execution' - an execution of a pipeline version designed with the demo (version):
//                     its measurements update the expected performance of the
//                     executed alternatives (provenance: measured);
//       'reference' - executions of homogeneous pipelines, one per family, run once
//                     to calibrate the scale: they give the highest value observed
//                     for each stage, used to normalise response time and cost.
//
// =====================================================================

const EXECUTIONS = [
  {
    id: 'movie-selected', role: 'execution', scenario: 'movie', version: 1,   // pipeline version executed
    name: 'Selected configuration of the movie scenario',
    sample: 9,                                   // recommendation requests
    stages: {
      input:      { component: 'input_processing.agent',     model: 'openai.gpt-oss-120b', time: 1.6025, tokens: 844.6 },
      candidates: { component: 'candidate_selection.agent',        model: 'openai.gpt-oss-120b', time: 5.9766, tokens: 7114.2 },
      scoring:    { component: 'scoring.llm',             model: 'openai.gpt-oss-120b', time: 8.9357, tokens: 3856.6 },
      ranking:    { component: 'ranking.traditional',     model: null,                  time: 0.0025, tokens: 0 },
      response:   { component: 'response_generation.agent', model: 'openai.gpt-oss-120b', time: 6.0656, tokens: 2009.7 }
    },
    pipeline: {
      time: 22.58, tokens: 13825,
      intent: 0.87, engagement: 1.00, accuracy: 0.56,
      remapped: 1.33, notMatched: 0.44
    }
  },

  // ---------- Reference executions (homogeneous pipelines) ----------
  {
    id: 'ref-traditional', role: 'reference', scenario: 'movie', name: 'Traditional pipeline', sample: 9,
    stages: {
      input:      { component: 'input_processing.rule_based',          model: null, time: 0.0002, tokens: 0 },
      candidates: { component: 'candidate_selection.traditional',            model: null, time: 0.0069, tokens: 0 },
      scoring:    { component: 'scoring.traditional',               model: null, time: 0.0031, tokens: 0 },
      ranking:    { component: 'ranking.traditional',               model: null, time: 0.0012, tokens: 0 },
      response:   { component: 'response_generation.simple_response', model: null, time: 0.0058, tokens: 0 }
    }
  },
  {
    id: 'ref-slm', role: 'reference', scenario: 'movie', name: 'SLM direct pipeline', sample: 9,
    stages: {
      input:      { component: 'input_processing.llm',     model: 'mistral.ministral-3-8b-instruct', time: 0.3835, tokens: 304.1 },
      candidates: { component: 'candidate_selection.llm',        model: 'mistral.ministral-3-8b-instruct', time: 2.1961, tokens: 558.8 },
      scoring:    { component: 'scoring.llm',           model: 'mistral.ministral-3-8b-instruct', time: 4.1867, tokens: 2314.9 },
      ranking:    { component: 'ranking.llm',           model: 'mistral.ministral-3-8b-instruct', time: 2.2620, tokens: 1154.3 },
      response:   { component: 'response_generation.llm', model: 'mistral.ministral-3-8b-instruct', time: 5.4804, tokens: 1878.7 }
    }
  },
  {
    id: 'ref-llm', role: 'reference', scenario: 'movie', name: 'LLM direct pipeline', sample: 9,
    stages: {
      input:      { component: 'input_processing.llm',     model: 'openai.gpt-oss-120b', time: 1.2398, tokens: 566.6 },
      candidates: { component: 'candidate_selection.llm',        model: 'openai.gpt-oss-120b', time: 2.9145, tokens: 1035.2 },
      scoring:    { component: 'scoring.llm',           model: 'openai.gpt-oss-120b', time: 7.1815, tokens: 3642.1 },
      ranking:    { component: 'ranking.llm',           model: 'openai.gpt-oss-120b', time: 3.5294, tokens: 1734.2 },
      response:   { component: 'response_generation.llm', model: 'openai.gpt-oss-120b', time: 4.1505, tokens: 1988.2 }
    }
  },
  {
    id: 'ref-agent', role: 'reference', scenario: 'movie', name: 'LLM agentic pipeline', sample: 9,
    stages: {
      input:      { component: 'input_processing.agent',     model: 'openai.gpt-oss-120b', time: 1.7579,  tokens: 949.2 },
      candidates: { component: 'candidate_selection.agent',        model: 'openai.gpt-oss-120b', time: 6.5958,  tokens: 10654.2 },
      scoring:    { component: 'scoring.agent',           model: 'openai.gpt-oss-120b', time: 10.2181, tokens: 6475.8 },
      ranking:    { component: 'ranking.agent',           model: 'openai.gpt-oss-120b', time: 8.3183,  tokens: 5603.8 },
      response:   { component: 'response_generation.agent', model: 'openai.gpt-oss-120b', time: 5.2952,  tokens: 2055.1 }
    }
  }
];

// How each measure is obtained (shown next to the values).
const MEASURES = {
  time:       { name: 'Response time',       unit: 's',      how: 'Average execution time per request' },
  tokens:     { name: 'Cost',                unit: 'tokens', how: 'Average input and output tokens per request' },
  intent:     { name: 'Intent recognition',  unit: '0–1',    how: 'LLM-as-a-judge (DeepEval)' },
  engagement: { name: 'Engagement',          unit: '0–1',    how: 'LLM-as-a-judge (DeepEval)' },
  accuracy:   { name: 'Accuracy',            unit: '0–1',    how: 'LLM-as-a-judge (DeepEval)' },
  remapped:   { name: 'Catalogue grounding', unit: 'items',  how: 'Items remapped to a catalogue item' },
  notMatched: { name: 'Catalogue grounding', unit: 'items',  how: 'Items not found in the catalogue' }
};
