// =====================================================================
// Execution results (Evaluation Evidence), used by execution feedback.
// Each execution records the configuration that was run and the measured
// values, with the sample size on which they are computed.
//
// Movie scenario, selected configuration (paper, case study), 9 queries:
//   - per stage: average time and tokens per request, from
//     framework/out/computed_results/METRICS_out_results_Scenario_2.json
//   - pipeline: time and tokens are the sums of the stage values;
//     intent recognition, engagement, accuracy and catalogue grounding are
//     the values reported in the paper.
// =====================================================================

const EXECUTIONS = [
  {
    id: 'movie-selected',
    name: 'Selected configuration of the movie scenario',
    scenario: 'movie',                          // measurements are valid only in their context
    sample: 9,                                   // recommendation requests
    stages: {
      input:      { component: 'input_parser.agent',     model: 'openai.gpt-oss-120b', time: 1.6025, tokens: 844.6 },
      candidates: { component: 'generator.agent',        model: 'openai.gpt-oss-120b', time: 5.9766, tokens: 7114.2 },
      scoring:    { component: 'scorer.llm',             model: 'openai.gpt-oss-120b', time: 8.9357, tokens: 3856.6 },
      ranking:    { component: 'ranker.traditional',     model: null,                  time: 0.0025, tokens: 0 },
      response:   { component: 'output_generator.agent', model: 'openai.gpt-oss-120b', time: 6.0656, tokens: 2009.7 }
    },
    pipeline: {
      time: 22.58, tokens: 13825,
      intent: 0.87, engagement: 1.00, accuracy: 0.56,
      remapped: 1.33, notMatched: 0.44
    }
  }
];

// How each measure is obtained (shown next to the values).
const MEASURES = {
  time:       { name: 'Response time',      unit: 's',               how: 'Average execution time per request' },
  tokens:     { name: 'Cost',               unit: 'tokens',          how: 'Average input and output tokens per request' },
  intent:     { name: 'Intent recognition', unit: '0–1',             how: 'LLM-as-a-judge (DeepEval)' },
  engagement: { name: 'Engagement',         unit: '0–1',             how: 'LLM-as-a-judge (DeepEval)' },
  accuracy:   { name: 'Accuracy',           unit: '0–1',             how: 'LLM-as-a-judge (DeepEval)' },
  remapped:   { name: 'Catalogue grounding', unit: 'items per response', how: 'Items remapped to a catalogue item' },
  notMatched: { name: 'Catalogue grounding', unit: 'items per response', how: 'Items not found in the catalogue' }
};
