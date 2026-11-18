// =====================================================================
// Demo application: state, design logic and rendering.
// Plain JavaScript, no build step. Data lives in data.js.
//
// Pages:
//   home     landing page (load an example, start a configuration, explore the design space)
//   space    design space: pipeline, dimensions, alternatives of each stage
//   config   design activities 1-3 (scenario characterisation ... alternative identification)
//   select   design activities 4-5 (alternative comparison, configuration selection)
//   monitor  design activity 6 (execution feedback)
// The top bar shows the brand (back to home) and one arrow per design activity (see progressBar).
// =====================================================================

// ---------- State ----------
const state = {
  page: 'home',
  scenario: null,                     // 'movie' | 'healthcare' | null (custom)
  context: {},                        // CONTEXT_FIELDS id -> text
  answers: {},                        // questionId -> optionId
  selections: {},                     // stageId -> alternative kind chosen by the designer
  models: {},                         // stageId -> language model id chosen by the designer
  params: {},                         // stageId -> { parameter: value } set by the designer
  rationale: {},                      // stageId -> designer's rationale for the choice
  showYaml: false,                    // configuration selection: configuration file shown
  inspect: null,                    // alternative comparison: { stage, variant } whose score is shown
  version: 1,                         // pipeline version (a new one is derived after execution feedback)
  revisions: {},                      // stageId -> variant -> criterion -> level revised by the designer
  draft: {},                          // monitoring: revisions not yet applied to a new version
  exploreStage: 'input',              // design-space page: selected stage
  exploreAlt: 'llm-agentic-external'  // design-space page: selected alternative
};

// ---------- Small helpers ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stageById = id => STAGES.find(s => s.id === id);
const criterionById = id => CRITERIA.find(c => c.id === id);

// Short names, e.g. "LLM agentic · internal".
const variantLabel = v => v === 'traditional' ? 'Traditional' : v.replace('slm', 'SLM').replace('llm', 'LLM').replace('-', ' ');
const altLabel = a => `${variantLabel(a.variant)} · ${a.deployment}`;

// =====================================================================
// Design logic
// =====================================================================

// Builds the full Alternative of a stage: design-space characteristics,
// technique, capabilities, required resources and expected performance.
function getAlternative(stageId, kind) {
  const base = ALTERNATIVE_KINDS.find(k => k.kind === kind);
  const st = STAGE_ALTERNATIVES[stageId];
  const style = base.type === 'traditional' ? 'traditional' : base.execution; // traditional | direct | agentic
  const performance = {};
  for (const [crit, levels] of Object.entries(st.est)) performance[crit] = levels[VARIANTS.indexOf(base.variant)];
  return {
    ...base,
    stage: stageId,
    technique: st.technique[style],
    component: st.component[style],
    capabilities: st.capabilities[style] || [],
    requiredResources: [...base.requiredResources, ...((st.requiredResources || {})[style] || [])],
    params: (st.params || {})[style] || {},
    performance           // estimated levels (see expectedPerformance for the values used in the comparison)
  };
}

const alternativesOf = stageId => ALTERNATIVE_KINDS.map(k => getAlternative(stageId, k.kind));

// Requirements specification: answers -> hard constraints and preferences.
// When several answers weigh the same criterion, the highest priority wins.
function deriveRequirements(answers) {
  const constraints = [], preferences = {};
  for (const q of QUESTIONS) {
    const opt = q.options.find(o => o.id === answers[q.id]);
    if (!opt) continue;
    (opt.constraints || []).forEach(c => constraints.push({ ...c, from: q.id }));
    for (const [crit, prio] of Object.entries(opt.preferences || {})) {
      if (!preferences[crit] || WEIGHTS[prio] > WEIGHTS[preferences[crit].priority]) {
        preferences[crit] = { priority: prio, weight: WEIGHTS[prio], from: q.id };
      }
    }
  }
  return { constraints, preferences };
}

// ---------- Hard constraints ----------
// Pipeline-level constraints concern the complete configuration (configuration selection);
// all the others concern single stages (alternative identification).
const isPipelineConstraint = c => !!c.pipeline;
const appliesToStage = (c, stageId) => !isPipelineConstraint(c) && (!c.stages || c.stages.includes(stageId));

// Does an alternative satisfy a stage-level constraint?
function satisfies(alt, c) {
  if (c.unavailable) return !alt.requiredResources.includes(c.unavailable);                     // required resource
  if (c.criterion) { const ep = expectedPerformance(alt, c.criterion); return !ep || ep.value >= LEVELS[c.min]; } // threshold
  if (c.requires.capability) return alt.capabilities.includes(c.requires.capability);          // capability
  return Object.entries(c.requires).every(([dim, val]) => alt[dim] === val);                   // design-space dimension
}

// Activity 3 - Alternative identification: every alternative of a stage, feasible or not,
// with the stage-level constraints it violates.
function identifyStage(stageId, req) {
  return alternativesOf(stageId).map(alt => {
    const violated = req.constraints.filter(c => appliesToStage(c, stageId) && !satisfies(alt, c));
    return { alt, feasible: violated.length === 0, reasons: violated.map(c => c.text) };
  });
}

// ---------- Expected performance used in the comparison ----------
// Criteria measured per stage, with the corresponding measure in the executions.
const MEASURED_CRITERIA = { time: 'time', cost: 'tokens' };

// Measurement of a criterion for a variant of a stage (with its default model), from the most recent
// execution of the current context of a pipeline version up to upTo.
function measurementOf(stageId, variant, crit, upTo) {
  const key = MEASURED_CRITERIA[crit];
  if (!key) return null;
  const alt = getAlternative(stageId, variant + '-internal');
  const executions = contextExecutions().filter(ex => ex.version <= upTo).sort((a, b) => b.version - a.version);
  for (const ex of executions) {
    const s = ex.stages[stageId];
    if (s && s.component === alt.component && s.model === (alt.model ? alt.model.id : null)) return { raw: s[key], sample: ex.sample };
  }
  return null;
}

// Highest value of a criterion observed for a stage, in all the executions of the context
// (reference executions included): the reference for normalisation.
function highestMeasurement(stageId, crit) {
  const key = MEASURED_CRITERIA[crit];
  const values = contextExecutions(['execution', 'reference']).map(ex => ex.stages[stageId]).filter(Boolean).map(s => s[key]);
  return values.length ? Math.max(...values) : null;
}

// Expected performance of an alternative on a criterion, as used in the comparison (higher is better):
//   Measured  - the alternative has been executed: the measurement, normalised with respect to the highest
//               value observed for the stage, onto the scale of the estimates: 0.9 - 0.8 * value / highest
//               (a value close to 0 counts as VH, the highest as VL);
//   Revised   - estimate revised by the designer after an execution;
//   Estimated - initial estimate of the designer.
// A pipeline version uses the measurements of the executions of the previous versions
// (upTo = the last version whose results are applied).
function expectedPerformance(alt, crit, upTo = state.version - 1) {
  const m = measurementOf(alt.stage, alt.variant, crit, upTo), max = m && highestMeasurement(alt.stage, crit);
  if (m && max !== null) return { kind: 'Measured', value: max > 0 ? 0.9 - 0.8 * m.raw / max : 0.9, raw: m.raw, sample: m.sample };
  const revised = ((state.revisions[alt.stage] || {})[alt.variant] || {})[crit];
  const level = revised || alt.performance[crit];
  return level ? { kind: revised ? 'Revised' : 'Estimated', level, value: LEVELS[level] } : null;
}

// ---------- Preferences ----------
// Contribution of each criterion the stage influences: expected performance, value and weight.
function scoreBreakdown(alt, preferences) {
  return STAGE_CRITERIA[alt.stage].map(crit => {
    const ep = expectedPerformance(alt, crit), pref = preferences[crit];
    return { crit, ep, value: ep ? ep.value : null, weight: pref ? pref.weight : 0, priority: pref ? pref.priority : null };
  });
}

// Weighted sum over the weighted criteria, normalised by the total weight.
function scoreAlternative(alt, preferences) {
  const parts = scoreBreakdown(alt, preferences).filter(p => p.weight && p.ep);
  const weights = parts.reduce((s, p) => s + p.weight, 0);
  return weights ? parts.reduce((s, p) => s + p.value * p.weight, 0) / weights : null;
}

// Activity 4 - Alternative comparison: feasible alternatives of a stage with score and rank, best first.
// Deployment does not change the expected performance, so the feasible deployments of the same
// variant (type + execution) are compared as one row:
//   { variant, alt (first feasible deployment), alts (all feasible deployments), score, rank }
// Ties share the rank.
function compareStage(stageId, req) {
  const rows = [];
  for (const r of identifyStage(stageId, req).filter(r => r.feasible)) {
    const row = rows.find(o => o.variant === r.alt.variant);
    if (row) row.alts.push(r.alt);
    else rows.push({ variant: r.alt.variant, alt: r.alt, alts: [r.alt], score: scoreAlternative(r.alt, req.preferences) });
  }
  rows.forEach(r => { r.rank = r.score === null ? null : 1 + rows.filter(o => o.score > r.score + 1e-9).length; });
  return rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// Activity 5 - Configuration selection: the designer's choice (variant + deployment) if still feasible,
// otherwise the best-ranked feasible alternative (or null). Returns the row with alt = the chosen alternative.
function selectedRow(stageId, ranked) {
  const kind = state.selections[stageId];
  const row = ranked.find(r => r.alts.some(a => a.kind === kind));
  if (row) return { ...row, alt: row.alts.find(a => a.kind === kind) };
  return ranked[0] || null;
}

// Labels of the feasible deployments of a row, e.g. "internal · external".
const deploymentChips = alts => alts.map(a => chip(DIMENSIONS.deployment.values[a.deployment], 'dim-' + a.deployment)).join(' ');

// Language model and parameters of the selected alternative (designer's choice or defaults).
function selectedModel(stageId, alt) {
  return alt.models.find(m => m.id === state.models[stageId]) || alt.model;
}
// Only the parameters of the selected alternative are kept (values set for another alternative are ignored).
const selectedParams = (stageId, alt) =>
  Object.fromEntries(Object.entries(alt.params).map(([k, v]) => [k, (state.params[stageId] || {})[k] ?? v]));

// =====================================================================
// Actions
// =====================================================================
function goTo(page) { state.page = page; render(); window.scrollTo(0, 0); }

function loadScenario(id) {
  state.scenario = id;
  const sc = SCENARIOS[id];
  state.context = { ...sc.context, description: sc.description, example: sc.example };
  state.answers = { ...sc.answers };
  resetDesign();
  Object.assign(state.selections, sc.selections || {});
  Object.assign(state.rationale, sc.rationale || {});
  goTo('config');
}

function startNew() { state.scenario = null; state.context = {}; state.answers = {}; resetDesign(); goTo('config'); }

// Forget the designer's choices of a previous configuration.
function resetDesign() {
  state.selections = {}; state.models = {}; state.params = {}; state.rationale = {}; state.inspect = null;
  state.version = 1; state.revisions = {}; state.draft = {};
}

// Execution feedback: a new pipeline version with the estimates revised by the designer.
function deriveVersion() {
  // The new version starts from the current configuration: rankings may change, selections change only if the designer says so.
  for (const { stage, sel } of currentConfiguration()) if (sel) state.selections[stage.id] = sel.alt.kind;
  for (const [stage, byVariant] of Object.entries(state.draft))
    for (const [variant, byCrit] of Object.entries(byVariant))
      for (const [crit, level] of Object.entries(byCrit)) {
        const target = ((state.revisions[stage] = state.revisions[stage] || {})[variant] = state.revisions[stage][variant] || {});
        if (level) target[crit] = level;                      // empty = keep the current value
      }
  state.draft = {};
  state.version += 1;
  goTo('select');   // the revised estimates change the comparison and the selection
}

// =====================================================================
// Rendering
// =====================================================================
function render() {
  $('#nav').innerHTML = progressBar();   // in the sticky top bar, so it stays visible while scrolling
  const views = { home: viewHome, space: viewDesignSpace, config: viewConfiguration, select: viewSelection, monitor: viewMonitoring };
  $('#view').innerHTML = views[state.page]();
}

// ---------- Progress through the design activities ----------
// One arrow per activity, in the top bar. By position: the activities of the previous pages are done,
// those of the current page are current, the following ones are still to do. Outside the design
// process (home, design space) every activity is still to do.
const ACTIVITIES = [
  { n: 1, name: 'Scenario characterisation',  page: 'config' },
  { n: 2, name: 'Requirements specification', page: 'config' },
  { n: 3, name: 'Alternative identification', page: 'config' },
  { n: 4, name: 'Alternative comparison',     page: 'select' },
  { n: 5, name: 'Configuration selection',    page: 'select' },
  { n: 6, name: 'Monitoring and review',      page: 'monitor' }
];
const PROCESS_PAGES = ['config', 'select', 'monitor'];

function progressBar() {
  const at = PROCESS_PAGES.indexOf(state.page);   // -1 outside the process: all to do
  // Home comes first, before activity 1: current on the home page, otherwise like a completed step.
  const home = `<li class="step-home ${state.page === 'home' ? 'step-current' : 'step-done'}"><button data-action="goto" data-page="home"
      ${state.page === 'home' ? 'aria-current="page"' : ''}><span class="step-name">Home</span></button></li>`;
  return `<nav class="activity-progress" aria-label="Design activities"><ol>${home}${ACTIVITIES.map(a => {
    const pos = PROCESS_PAGES.indexOf(a.page);
    const status = at < 0 || pos > at ? 'todo' : pos < at ? 'done' : 'current';
    return `<li class="step-${status}"><button data-action="activity" data-n="${a.n}" title="${a.n}. ${a.name}" ${status === 'current' ? 'aria-current="step"' : ''}>
      <span class="step-num">${status === 'done' ? '✓' : a.n}</span><span class="step-name">${a.name}</span></button></li>`;
  }).join('')}</ol></nav>`;
}

// Opens the page of an activity and brings its section into view.
function goToActivity(n) {
  const a = ACTIVITIES.find(x => x.n === n);
  if (state.page !== a.page) goTo(a.page);
  const head = $(`#activity-${n}`);
  if (head && ACTIVITIES.find(x => x.page === a.page).n !== n) head.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });   // first activity of the page: top of the page
}

// ---------- Shared fragments ----------
function chip(text, cls = '') { return `<span class="chip ${cls}">${esc(text)}</span>`; }

function dimensionChips(alt) {
  return chip(DIMENSIONS.type.values[alt.type], 'dim-type') +
         chip(DIMENSIONS.deployment.values[alt.deployment], 'dim-' + alt.deployment) +
         chip(DIMENSIONS.execution.values[alt.execution], 'dim-exec');
}

function levelBadge(level) {
  if (!level) return '<span class="muted">—</span>';
  return `<span class="level" title="${LEVEL_NAMES[level]} (${LEVELS[level]})">
            <span class="bar"><span style="width:${LEVELS[level] * 100}%"></span></span>${level}</span>`;
}

function scoreBar(score) {
  if (score === null) return '<span class="muted small">no weighted criteria</span>';
  return `<span class="level"><span class="bar wide"><span style="width:${score * 100}%"></span></span>${score.toFixed(3)}</span>`;
}

// Numbered section header of a design activity.
function activityHead(n, title, text) {
  return `<div class="activity-head" id="activity-${n}"><span class="activity-num">${n}</span><div><h2>${title}</h2><p class="muted">${text}</p></div></div>`;
}

function todo(text) { return `<div class="todo-box">${chip('to do', 'todo')} ${text}</div>`; }

// =====================================================================
// Page: Home
// =====================================================================
function viewHome() {
  return `
  <section class="hero">
    <h1>Recommending the Recommender</h1>
    <p>Design a recommendation pipeline stage by stage. Answer a few questions about your application, see which
       traditional or language-model-based alternatives satisfy its constraints and best fit its priorities,
       and obtain a configuration file that the framework executes.</p>
  </section>

  <!-- Ways to start: a new configuration or the design space, or one of the paper examples. -->
  <section class="card">
    <div class="card-head"><h2>How do you want to start?</h2></div>
    <div class="start-main">
      <div class="start-row">
        <h4>Create a new configuration</h4>
        <button class="btn primary" data-action="new">Start designing →</button>
      </div>
      <div class="start-row">
        <h4>Explore the design space</h4>
        <button class="btn" data-action="goto" data-page="space">Explore →</button>
      </div>
    </div>

    <div class="start-divider"><span>or load an example from the paper</span></div>
    <div class="start-grid">
      ${Object.entries(SCENARIOS).map(([id, sc]) => `
        <div class="start-option">
          <div class="example-row">
            <div>
              <h4>${sc.name}</h4>
              <p>${sc.description}</p>
            </div>
            <button class="btn" data-action="scenario" data-id="${id}">Load example →</button>
          </div>
        </div>`).join("")}
    </div>
  </section>`;
}

// =====================================================================
// Page: Design space
// =====================================================================
function viewDesignSpace() {
  const stage = stageById(state.exploreStage);
  return `
  <div class="page-top"></div>

  <div class="intro-grid">
  <section class="card">
    <div class="card-head"><h2>Design activities</h2></div>
    <ol class="activity-list">
      <li><strong>Scenario characterisation</strong> — the designer answers predefined questions.</li>
      <li><strong>Requirements specification</strong> — answers imply hard constraints and preferences over criteria.</li>
      <li><strong>Alternative identification</strong> — alternatives violating a hard constraint are excluded.</li>
      <li><strong>Alternative comparison</strong> — feasible alternatives are ranked according to the preferences.</li>
      <li><strong>Configuration selection</strong> — one alternative per stage, with its model and parameters; configuration file.</li>
      <li><strong>Monitoring and review</strong> — measurements verify the constraints and update the expected performance.</li>
    </ol>
  </section>

  <section class="card">
    <div class="card-head"><h2>Design-space dimensions</h2></div>
    <div class="dims">
      <div><h4>Component type</h4><p>Traditional, SLM or LLM</p></div>
      <div><h4>Deployment</h4><p>Internal or external provider: where user data flow</p></div>
      <div><h4>Execution</h4><p>Direct, or agentic with tools (e.g. Text-to-SQL)</p></div>
    </div>
  </section>
  </div>

  <section class="card">
    <div class="card-head"><h2>Stages and alternatives</h2><span class="muted">Select a stage, then an alternative</span></div>
    <div class="pipeline">
      ${STAGES.map((s, i) => `
        ${i ? '<span class="arrow" aria-hidden="true">→</span>' : ''}
        <button class="stage-box ${s.id === stage.id ? 'selected' : ''}" data-action="explore" data-stage="${s.id}">
          <strong><span class="stage-num">${i + 1}</span>${s.name}</strong>
          <small>→ ${s.output}</small>
        </button>`).join('')}
    </div>

    <div class="stage-facts">
      <div><span class="fact-label">Traditional techniques</span>${stage.traditional}</div>
      <div><span class="fact-label">LM capabilities</span>${stage.capabilities}</div>
      <div><span class="fact-label">LM limitations</span>${stage.limitations}</div>
      <div><span class="fact-label">Criteria influenced</span>${STAGE_CRITERIA[stage.id].map(c => chip(criterionById(c).name)).join(' ')}</div>
    </div>

    <div class="stage-detail">
      <div>${altMatrix(stage.id)}</div>
      <div>${altDetail(getAlternative(stage.id, state.exploreAlt))}</div>
    </div>
  </section>


  <div class="nav-buttons"><button class="btn" data-action="goto" data-page="home">← Home</button>
    <button class="btn primary" data-action="new">Start new configuration →</button></div>`;
}

// Design-space matrix of a stage: rows = type + execution, columns = deployment.
function altMatrix(stageId) {
  const cell = (variant, deployment) => {
    const alt = getAlternative(stageId, `${variant}-${deployment}`);
    return `<button class="matrix-cell ${alt.kind === state.exploreAlt ? 'selected' : ''}" data-action="explore-alt" data-kind="${alt.kind}">
              <small>${alt.model ? alt.model.name : 'No language model'}</small>
            </button>`;
  };
  return `
  <div class="label">Design space · ${ALTERNATIVE_KINDS.length} alternatives</div>
  <div class="matrix">
    <div></div><div class="matrix-col">Internal</div><div class="matrix-col">External</div>
    ${VARIANTS.map(v => `<div class="matrix-row">${variantLabel(v)}</div>${cell(v, 'internal')}${cell(v, 'external')}`).join('')}
  </div>
  <p class="small muted">Traditional techniques have no agentic execution. Further techniques and models can be added to the framework.</p>`;
}

// Details of one alternative: technique, language model, characteristics and expected performance.
function altDetail(alt) {
  const none = '<span class="muted">—</span>';
  return `
  <div class="alt-detail">
    <div class="alt-detail-head"><h3>${[DIMENSIONS.type.values[alt.type], alt.type === 'traditional' ? null : alt.execution, alt.deployment].filter(Boolean).join(' · ')}</h3></div>
    <p>${esc(alt.technique)}</p>
    <div class="alt-columns"><div>
    <div class="alt-facts">
      <div><span class="fact-label">Language model</span>${alt.model ? alt.model.name : none}</div>
    </div>
    <!-- Characteristics: what the alternative supports and what it requires (its dimensions are in the title) -->
    <div class="alt-facts characteristics">
      <div><span class="fact-label">Supports</span>${alt.capabilities.map(c => chip(CAPABILITIES[c])).join(' ') || none}</div>
      <div><span class="fact-label">Requires</span>${alt.requiredResources.map(r => chip(REQUIRED_RESOURCES[r].name)).join(' ') || none}</div>
    </div>
    </div><div>
    <div class="label">Expected performance <span class="label-note">· estimated · higher is better</span></div>
    <ul class="perf-list">
      ${STAGE_CRITERIA[alt.stage].map(c => `
        <li>
          <span>${criterionById(c).name}</span>${levelBadge(alt.performance[c])}
        </li>`).join('')}
    </ul>
    </div></div>
  </div>`;
}

// =====================================================================
// Page: Configuration (design activities 1-3)
// =====================================================================
// Context of the design: free-text fields, stored in state.context.
function contextCard() {
  const field = f => {
    const v = esc(state.context[f.id] || '');
    const attrs = `name="${f.id}" data-action="context" placeholder="${esc(f.placeholder)}"`;
    return `<label class="field ${f.long ? 'wide' : ''}"><span class="fact-label">${f.label}</span>
      ${f.long ? `<textarea rows="2" ${attrs}>${v}</textarea>` : `<input type="text" ${attrs} value="${v}">`}</label>`;
  };
  return `
  <div class="card">
    <div class="card-head"><h2>Context</h2></div>
    <div class="field-grid">${CONTEXT_FIELDS.map(field).join('')}</div>
  </div>`;
}

function viewConfiguration() {
  return `
  <div class="page-top"></div>

  <section class="activity-section">
    <div class="two-col">
      <div>
        ${activityHead(1, 'Scenario characterisation', '')}
        ${contextCard()}
        <p class="small muted" id="answered-count">${answeredText()}</p>
        ${QUESTION_GROUPS.map(g => `
          <div class="card">
            <div class="card-head"><h2>${g.name}</h2></div>
            ${QUESTIONS.filter(q => q.group === g.id).map(questionBlock).join('')}
          </div>`).join('')}
      </div>
      <aside class="sticky">
        ${activityHead(2, 'Requirements specification', '')}
        <div id="requirements">${requirementsPanel()}</div>
        <div class="aside-activity" id="identification">${identificationSection()}</div>
      </aside>
    </div>
  </section>

  <div class="actions end page-actions">
    <button class="btn primary with-num" data-action="goto" data-page="select"><span class="activity-num">4</span> Comparison and selection →</button>
  </div>`;
}

// =====================================================================
// Page: Comparison and selection (design activities 4-5)
// =====================================================================
function viewSelection() {
  return `
  <div class="page-top"></div>

  <section class="activity-section" id="comparison">${comparisonSection()}</section>

  <hr class="activity-divider">
  <section class="activity-section" id="selection">${selectionSection()}</section>`;   // its buttons are at the end of activity 5
}

const answeredText = () => `${QUESTIONS.filter(q => state.answers[q.id]).length} of ${QUESTIONS.length} questions answered`;

function questionBlock(q) {
  return `
  <fieldset class="question">
    <legend>${q.text}</legend>
    ${q.options.map(o => `
      <label class="option ${state.answers[q.id] === o.id ? 'checked' : ''}">
        <input type="radio" name="${q.id}" value="${o.id}" ${state.answers[q.id] === o.id ? 'checked' : ''} data-action="answer">
        <span>${o.text}</span>
      </label>`).join('')}
  </fieldset>`;
}

// ---------- Requirements specification ----------

function requirementsPanel() {
  const req = deriveRequirements(state.answers);
  const qText = id => QUESTIONS.find(q => q.id === id).text;
  return `
  <div class="card">
    <div class="label">Hard constraints</div>
    ${req.constraints.length ? `<ul class="req-list">${req.constraints.map(c => `<li title="From: ${esc(qText(c.from))}">${esc(c.text)}</li>`).join('')}</ul>` : '<p class="muted">None yet</p>'}

    <div class="label">Criteria and preferences</div>
    <ul class="pref-list">${CRITERIA.map(c => {
      const p = req.preferences[c.id];
      return `<li ${p ? `title="From: ${esc(qText(p.from))}"` : ''}><span>${c.name}</span>
        ${p ? `<span class="prio prio-${p.priority}">${p.priority} · weight ${p.weight}</span>` : '<span class="muted small">not weighted</span>'}</li>`;
    }).join('')}</ul>  </div>`;
}

// ---------- Activity 3: Alternative identification ----------
function identificationSection() {
  const req = deriveRequirements(state.answers);
  const identified = STAGES.map(s => ({ stage: s, rows: identifyStage(s.id, req) }));
  const cell = r => {
    const tip = altLabel(r.alt) + (r.feasible ? ' · feasible' : ' · excluded: ' + r.reasons.join('; '));
    return `<td class="ef ${r.feasible ? 'st-feasible' : 'st-excluded'}" title="${esc(tip)}">${r.feasible ? '✓' : '✗'}</td>`;
  };
  return `
  ${activityHead(3, 'Alternative identification', '')}
  <div class="card">
    <div class="table-wrap"><table class="effects">
      <thead><tr><th>Stage</th><th></th>${VARIANTS.map(v => `<th>${variantLabel(v)}</th>`).join('')}</tr></thead>
      ${identified.map(({ stage, rows }) => `<tbody>${['internal', 'external'].map((d, i) => `
        <tr>${i === 0 ? `<th rowspan="2" class="ef-stage">${stage.name}</th>` : ''}
          <td class="ef-dep">${d}</td>
          ${VARIANTS.map(v => cell(rows.find(r => r.alt.kind === `${v}-${d}`))).join('')}
        </tr>`).join('')}</tbody>`).join('')}
    </table></div>
    <p class="table-note muted">Each alternative is <span class="lg st-feasible">✓ feasible</span> or
      <span class="lg st-excluded">✗ excluded</span> if it violates a hard constraint. Hover a cell for the reason.</p>
  </div>`;
}

// ---------- Activity 4: Alternative comparison ----------
// Rank is undefined when no criterion is weighted yet.
const rankText = r => r.rank === null ? '—' : '#' + r.rank;

function comparisonSection() {
  const req = deriveRequirements(state.answers);
  const comparisons = STAGES.map(s => ({ stage: s, ranked: compareStage(s.id, req) }));
  // Score breakdown of the inspected alternative, if it is still feasible.
  const ins = state.inspect && comparisons.find(c => c.stage.id === state.inspect.stage);
  const insRow = ins && ins.ranked.find(r => r.variant === state.inspect.variant);
  return `
  ${activityHead(4, 'Alternative comparison', '')}
  <div class="two-col compare-layout">
  <div class="compare-stack">
    ${comparisons.map(({ stage, ranked }) => `
    <div class="card stage-compare">
      <div class="card-head"><h2>${stage.name}</h2><span class="muted">${ranked.length} feasible</span></div>
      ${ranked.length ? `<ul class="rank-list">${ranked.map(r => `
        <li><button class="rank-row ${insRow && ins.stage.id === stage.id && insRow.variant === r.variant ? 'selected' : ''}"
                    data-action="inspect" data-stage="${stage.id}" data-variant="${r.variant}">
          <span class="rank">${rankText(r)}</span>
          <span class="rank-name">${variantLabel(r.variant)} <span class="rank-dep">${r.alts.map(a => a.deployment).join(' · ')}</span></span>
          ${scoreBar(r.score)}
        </button></li>`).join('')}</ul>`
        : '<p class="warn-text">No feasible alternative: revise the answers.</p>'}
    </div>`).join('')}
  </div>
  <aside class="sticky">
    ${insRow ? scoreDetail(ins.stage, insRow, req)
      : '<div class="card score-placeholder"><p class="muted">Click an alternative to see how its score is obtained.</p></div>'}
  </aside>
  </div>`;
}

// How the score of an alternative is obtained: estimates, weights and their provenance.
function scoreDetail(stage, row, req) {
  const alt = row.alt;
  const parts = scoreBreakdown(alt, req.preferences);
  const kinds = [...new Set(parts.filter(p => p.ep).map(p => p.ep.kind))];
  return `
  <div class="card score-detail">
    <div class="card-head"><h2>${stage.name} · ${variantLabel(row.variant)}</h2><span>${deploymentChips(row.alts)}</span></div>
    <div class="alt-summary">
      <div><span class="fact-label">Technique</span>${esc(alt.technique)}</div>
      ${alt.model ? `<div><span class="fact-label">Language model</span>${alt.model.name}</div>` : ''}
    </div>
    <div class="score-grid">
    <div class="table-wrap flat"><table class="alts">
      <thead><tr><th>Criterion</th><th>Expected performance</th><th>Provenance</th><th>Weight</th><th>Weighted value</th></tr></thead>
      <tbody>${parts.map(p => `
        <tr class="${p.weight ? '' : 'muted'}"><th>${criterionById(p.crit).name}</th><td>${expectedCell(p.crit, p.ep)}</td>
          <td>${p.ep ? p.ep.kind : '—'}</td>
          <td>${p.weight ? `${p.weight} <span class="muted small">(${p.priority})</span>` : 'not weighted'}</td>
          <td>${p.weight && p.ep ? (p.value * p.weight).toFixed(2) : '—'}</td></tr>`).join('')}
        <tr class="total-row"><th>Score</th><td colspan="3" class="muted small">sum of weighted values / total weight</td>
          <td>${row.score === null ? '—' : row.score.toFixed(3)}</td></tr>
      </tbody>
    </table></div>
    <div>
      <div class="label">Provenance of the expected performance</div>
      <dl class="provenance">${kinds.map(k => `<dt>${k}</dt><dd>${PROVENANCE[k]}</dd>`).join('')}</dl>
    </div>
    </div>
  </div>`;
}

// Expected performance cell: level for (revised) estimates, normalised value for measurements.
function expectedCell(crit, ep) {
  if (!ep) return '<span class="muted">—</span>';
  // Measured values are on the same 0-1 scale as the estimates; the raw measure is shown in monitoring.
  if (ep.kind === 'Measured') return `<span class="level"><span class="bar"><span style="width:${ep.value * 100}%"></span></span>${ep.value.toFixed(2)}</span>`;
  return `${levelBadge(ep.level)} <span class="muted small">= ${ep.value}</span>`;
}

// ---------- Activity 5: Configuration selection ----------
// The configuration: for each stage, its ranked feasible alternatives and the selected one.
function currentConfiguration() {
  const req = deriveRequirements(state.answers);
  return STAGES.map(s => {
    const ranked = compareStage(s.id, req);
    return { stage: s, ranked, sel: selectedRow(s.id, ranked) };
  });
}

function selectionSection() {
  const req = deriveRequirements(state.answers);
  const rows = currentConfiguration();
  return `
  ${activityHead(5, 'Configuration selection', '')}
  <div class="card">
    <div class="table-wrap"><table class="alts selection">
      <thead><tr><th>Stage</th><th>Alternative</th><th>Deployment</th><th>Language model</th><th>Parameters</th><th>Rationale</th></tr></thead>
      <tbody>${rows.map(({ stage, ranked, sel }) => {
        if (!sel) return `<tr><th>${stage.name}</th><td colspan="5" class="warn-text">No feasible alternative</td></tr>`;
        const alt = sel.alt, model = selectedModel(stage.id, alt), params = selectedParams(stage.id, alt);
        return `<tr><th>${stage.name}</th>
          <td><select data-action="select" data-stage="${stage.id}">${ranked.map(r =>
              `<option value="${r.variant}" ${r.variant === sel.variant ? 'selected' : ''}>${rankText(r)} ${variantLabel(r.variant)}${r.score === null ? '' : ' · ' + r.score.toFixed(3)}</option>`).join('')}
            </select>
            </td>
          <td><select data-action="deployment" data-stage="${stage.id}">${sel.alts.map(a =>
              `<option value="${a.kind}" ${a.kind === alt.kind ? 'selected' : ''}>${DIMENSIONS.deployment.values[a.deployment]}</option>`).join('')}</select></td>
          <td>${alt.models.length ? `<select data-action="model" data-stage="${stage.id}">${alt.models.map(m =>
              `<option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
              <div><code class="small">${model.id}</code></div>` : '<span class="muted">—</span>'}</td>
          <td>${Object.keys(params).length ? Object.entries(params).map(([k, v]) => `
              <label class="param"><code>${k}</code><input type="number" min="1" value="${v}" data-action="param" data-stage="${stage.id}" name="${k}"></label>`).join('')
              : '<span class="muted">—</span>'}</td>
          <td><textarea class="rationale-input" rows="2" data-action="rationale" data-stage="${stage.id}"
                placeholder="${sel.rank === null || sel.rank === 1 ? 'Follows the ranking' : 'Why is it preferred to the best ranked?'}">${esc(state.rationale[stage.id] || '')}</textarea></td></tr>`;
      }).join('')}</tbody>
    </table></div>

    <div class="label">Constraints on the complete pipeline</div>
    ${pipelineConstraints(req)}
    <div id="yaml-panel">${state.showYaml ? yamlPanel(rows) : ''}</div>
  </div>
  <div class="nav-buttons">
    <button class="btn" data-action="goto" data-page="config">← Back to configuration</button>
    ${state.showYaml ? '' : '<button class="btn primary" data-action="yaml">Generate YAML configuration file</button>'}
  </div>`;
}

// Pipeline-level constraints (e.g. maximum response time) are checked on the complete configuration.
// With qualitative estimates the pipeline value cannot be computed: they are verified on measured values.
// ---------- Configuration file (YAML read by the framework) ----------
// Steps and parameters follow framework/config/schema.yaml. Deployment and rationale are not read
// by the framework, so they are kept as comments, together with the context.
function yamlText(rows) {
  const q = v => JSON.stringify(String(v));                      // quoted YAML string
  const oneLine = v => String(v).replace(/\s+/g, ' ').trim();     // safe inside a comment
  const ctx = CONTEXT_FIELDS.filter(f => !f.long && state.context[f.id]);
  const response = rows.find(r => r.stage.id === 'response').sel.alt.component;
  const lines = [
    '# Recommender pipeline configuration, generated by the Recommender Design Demo.',
    `# Pipeline version: v${state.version}`,
    ...ctx.map(f => `# ${f.label}: ${oneLine(state.context[f.id])}`),
    '',
    'state:', `  class: ${FRAMEWORK_CONFIG.state}`, '',
    'user_model:', `  class: ${FRAMEWORK_CONFIG.userModel}`, '',
    'orchestrator:', `  name: ${FRAMEWORK_CONFIG.orchestrator}`, '  params:',
    `    ask_info_step: ${q(response)}`, `    fallback_step: ${q(response)}`, '',
    'steps:'
  ];
  for (const { stage, sel } of rows) {
    const alt = sel.alt, model = selectedModel(stage.id, alt), params = selectedParams(stage.id, alt);
    const why = state.rationale[stage.id] || (sel.rank === null || sel.rank === 1 ? 'Follows the ranking' : '');
    lines.push(`  # ${stage.name}: ${altLabel(alt)}${why ? ' - ' + oneLine(why) : ''}`);
    lines.push(`  - name: ${alt.component}`);
    const p = { ...(model ? { model: model.id } : {}), ...params };
    if (Object.keys(p).length) {
      lines.push('    params:');
      for (const [k, v] of Object.entries(p)) lines.push(`      ${k}: ${typeof v === 'number' ? v : q(v)}`);
    }
  }
  return lines.join('\n') + '\n';
}

function yamlPanel(rows) {
  // The generate button is hidden while the panel is shown, so the panel has its own Close button.
  const close = '<button class="btn" data-action="yaml">Close</button>';
  if (rows.some(r => !r.sel)) return `<p class="warn-text">Every stage needs a feasible alternative before the configuration file can be generated.</p>
    <div class="actions end">${close}</div>`;
  return `
  <div class="yaml-box">
    <div class="yaml-head"><span class="fact-label">${FRAMEWORK_CONFIG.fileName}</span>
      <span class="actions"><button class="btn" data-action="copy-yaml">Copy</button>
      <button class="btn outline" data-action="download-yaml">Download</button>${close}</span></div>
    <pre><code>${esc(yamlText(rows))}</code></pre>
  </div>`;
}

function downloadYaml() {
  const blob = new Blob([yamlText(currentConfiguration())], { type: 'text/yaml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = FRAMEWORK_CONFIG.fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function pipelineConstraints(req) {
  const list = req.constraints.filter(isPipelineConstraint);
  if (!list.length) return '<p class="muted small">None</p>';
  return `<ul class="req-list">${list.map(c => `<li>${esc(c.text)}</li>`).join('')}</ul>`;
}

// ---------- Evaluation evidence ----------
// Executions of the current context with the given roles (measurements do not transfer to other contexts).
const contextExecutions = (roles = ['execution']) => EXECUTIONS.filter(ex => ex.scenario === state.scenario && roles.includes(ex.role));

// Does an execution step correspond to an alternative with a given model?
const sameStep = (s, alt, model) => !!s && s.component === alt.component && s.model === (model ? model.id : null);

// Execution of the current pipeline version: it ran exactly the selected configuration.
function currentExecution(rows) {
  return contextExecutions().find(ex => ex.version === state.version &&
    rows.every(({ stage, sel }) => sameStep(ex.stages[stage.id], sel.alt, selectedModel(stage.id, sel.alt)))) || null;
}

// Executions of the previous pipeline versions, most recent first.
const previousExecutions = () => contextExecutions().filter(ex => ex.version < state.version).sort((a, b) => b.version - a.version);

// Executed alternative of a stage, e.g. "LLM agentic · GPT-OSS-120B".
function executedLabel(stageId, s) {
  const variant = VARIANTS.find(v => {
    const a = getAlternative(stageId, v + '-internal');
    return a.component === s.component && (a.models.length ? a.models.some(m => m.id === s.model) : s.model === null);
  });
  const model = LANGUAGE_MODELS.find(m => m.id === s.model);
  return (variant ? variantLabel(variant) : s.component) + (model ? ` <span class="muted small">· ${model.name}</span>` : '');
}

const fmtTime = s => (s < 0.01 ? s.toFixed(3) : s.toFixed(2)) + ' s';
const fmtTokens = t => Math.round(t).toLocaleString('en-US');
const fmtMeasure = (crit, raw) => crit === 'time' ? fmtTime(raw) : fmtTokens(raw) + ' tokens';

// An execution: the executed pipeline (left) and the measured values of the criteria (right).
// Per-stage response time and cost are shown when updating the expected performance.
function executionTables(ex) {
  return `
    <div class="execution-grid">
      <div class="subcard">
        <div class="subcard-head"><h3>Executed pipeline</h3></div>
        <div class="table-wrap flat"><table class="alts">
          <thead><tr><th>Stage</th><th>Executed alternative</th></tr></thead>
          <tbody>${STAGES.map(stage => `<tr><th>${stage.name}</th><td>${executedLabel(stage.id, ex.stages[stage.id])}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="subcard">
        <div class="subcard-head"><h3>Measured values</h3><span class="muted small">sample size n = ${ex.sample}</span></div>
        <div class="table-wrap flat"><table class="alts">
          <thead><tr><th>Criterion</th><th>Measured value</th><th>Measure</th></tr></thead>
          <tbody>
            ${['time', 'tokens', 'intent', 'engagement', 'accuracy', 'remapped', 'notMatched'].map(k => {
              const v = ex.pipeline[k], m = MEASURES[k];
              const val = k === 'time' ? fmtTime(v) : k === 'tokens' ? fmtTokens(v) + ' tokens' : v.toFixed(2) + (m.unit === '0–1' ? '' : ' ' + m.unit);
              return `<tr><th>${m.name}</th><td>${val}</td><td class="muted small">${m.how}${m.unit === '0–1' ? ', scale 0–1' : ''}</td></tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
    </div>`;
}

// Stage measurement of a criterion (response time, cost), shown next to its normalised value.
function stageMeasure(crit, s) {
  return crit === 'time' ? fmtTime(s.time) : fmtTokens(s.tokens) + ' tokens';
}

// Update of the expected performance of the executed alternatives, one box per stage: response time and cost
// become measured; the other criteria are measured on the complete pipeline and the designer may revise their estimates.
function revisionSection(rows, ex) {
  const draftOf = (st, v, c) => ((state.draft[st] || {})[v] || {})[c];
  return `
    <div class="section-head"><h3>Update the expected performance</h3><span class="muted small">sample size n = ${ex.sample}</span></div>
    <p class="small muted">Response time and cost of the executed alternatives are replaced by their measurements, normalised with respect to
       the highest value observed for the stage.<br> The other criteria are measured on the complete pipeline: the designer may revise their estimates.</p>
    <div class="revision-grid">
      ${rows.map(({ stage, sel }) => {
        const alt = sel.alt, s = ex.stages[stage.id];
        return `<div class="subcard">
          <div class="subcard-head"><h3>${stage.name}</h3><span class="muted small">${variantLabel(alt.variant)}</span></div>
          <table class="alts revision">
            <thead><tr><th>Criterion</th><th>Current</th><th>New</th></tr></thead>
            <tbody>${STAGE_CRITERIA[stage.id].map(c => {
              const ep = expectedPerformance(alt, c), d = draftOf(stage.id, alt.variant, c);
              const next = expectedPerformance(alt, c, state.version);  // value once the results of this version are applied
              return `<tr><th>${criterionById(c).name}</th>
                <td>${expectedCell(c, ep)}</td>
                <td>${next && next.kind === 'Measured' ? `${expectedCell(c, next)} <div class="evidence">measured (${stageMeasure(c, s)})</div>` : `
                  <select data-action="revise" data-stage="${stage.id}" data-variant="${alt.variant}" data-crit="${c}">
                    <option value="">Keep ${ep ? ep.level : ''}</option>
                    ${Object.keys(LEVELS).map(l => `<option value="${l}" ${d === l ? 'selected' : ''}>${l}</option>`).join('')}
                  </select>`}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;
      }).join('')}
    </div>
    <div class="actions end">
      <button class="btn primary" data-action="derive">Derive pipeline version v${state.version + 1} →</button>
    </div>`;
}

// ---------- Diagnostics ----------
// Few automatic remarks on the execution, shown only when they apply:
//   - the stage with the largest share of response time and of cost;
//   - estimates that differ from the measurement by at least one level of the scale (largest two);
//   - for each violated constraint, where to act (or the requirement to revise when it cannot be met).
function diagnosticsBox(rows, ex, req) {
  const shares = [], gaps = [], hints = [];
  const total = k => STAGES.reduce((sum, st) => sum + ex.stages[st.id][k], 0);
  const dominant = k => STAGES.reduce((a, b) => ex.stages[b.id][k] > ex.stages[a.id][k] ? b : a);
  for (const [k, name] of [['time', 'Response time'], ['tokens', 'Cost']]) {
    const st = dominant(k), share = total(k) ? ex.stages[st.id][k] / total(k) : 0;
    const of = k === 'time' ? 'total time' : 'total cost';
    if (share > 0) shares.push(`<li><span>${name}</span><span><strong>${st.name}</strong> · ${Math.round(share * 100)}% of ${of}</span></li>`);
  }
  const deviations = [];
  for (const { stage, sel } of rows)
    for (const c of Object.keys(MEASURED_CRITERIA)) {
      const now = expectedPerformance(sel.alt, c), next = expectedPerformance(sel.alt, c, state.version);
      if (now && next && now.kind !== 'Measured' && Math.abs(next.value - now.value) >= 0.2 - 1e-9)
        deviations.push({ stage, c, now, next, gap: Math.abs(next.value - now.value) });
    }
  // Stage, then criterion with the direction of the gap (values are higher-is-better); estimated → measured on the right.
  const verdict = { time: ['faster', 'slower'], cost: ['cheaper', 'more expensive'] };
  deviations.sort((a, b) => b.gap - a.gap).slice(0, 2).forEach(d =>
    gaps.push(`<li><span><strong>${d.stage.name}</strong><br><span class="muted small">${criterionById(d.c).name}: ${verdict[d.c][d.next.value < d.now.value ? 1 : 0]}</span></span>
      <span class="gap">${expectedCell(d.c, d.now)} → ${expectedCell(d.c, d.next)}</span></li>`));
  for (const c of req.constraints) {
    if (c.pipeline === 'time' && ex.pipeline.time > c.max) {
      // Fastest pipeline observed: the fastest measured alternative of every stage.
      const fastest = STAGES.reduce((sum, st) => sum + Math.min(...contextExecutions(['execution', 'reference']).map(e => e.stages[st.id]).filter(Boolean).map(x => x.time)), 0);
      hints.push(fastest > c.max ? `<li>Revise the maximum response time: ${c.max} s cannot be met</li>` : `<li>Revise <strong>${dominant('time').name}</strong> to reduce response time</li>`);
    }
    if (c.verify && ex.pipeline[c.verify.measure] > c.verify.max)
      hints.push(`<li>Revise <strong>${c.stages.map(id => stageById(id).name).join(', ')}</strong>: ${esc(c.text.toLowerCase())}</li>`);
  }
  return `
      <div class="subcard">
        <div class="subcard-head"><h3>Diagnostics</h3><span class="muted small">automatic remarks on the execution</span></div>
        <div class="label pad-label">Largest share of the pipeline</div>
        <ul class="diag-rows">${shares.join('')}</ul>
        ${gaps.length ? `<div class="label pad-label">Estimates far from the measurement</div><ul class="diag-rows">
          <li class="diag-head"><span></span><span>estimated → measured</span></li>${gaps.join('')}</ul>` : ''}
        ${hints.length ? `<div class="label pad-label">Review suggestions</div><ul class="diag-list">${hints.join('')}</ul>` : ''}
      </div>`;
}

// Stage-level constraints: satisfied by design (the selected alternatives are feasible); those with a
// measurable condition are also verified on the measured values of the complete pipeline.
function verifyStageConstraint(c, ex) {
  if (!c.verify) return { status: 'ok', text: 'satisfied' };
  if (!ex) return { status: 'unknown', text: 'not yet measured' };
  const v = ex.pipeline[c.verify.measure], ok = v <= c.verify.max;
  return { status: ok ? 'ok' : 'violated', text: `${ok ? 'satisfied' : 'violated'} · ${v.toFixed(2)} not matched` };
}

// Pipeline-level constraints checked on measured values.
function verifyPipelineConstraint(c, ex) {
  if (!ex) return { status: 'unknown', text: 'not yet measured' };
  if (c.pipeline === 'time') {
    const ok = ex.pipeline.time <= c.max;
    return { status: ok ? 'ok' : 'violated', text: `${ok ? 'satisfied' : 'violated'} · ${fmtTime(ex.pipeline.time)}` };
  }
  return { status: 'unknown', text: 'No measurement for this constraint' };
}

// =====================================================================
// Page: Monitoring (design activity 6: execution feedback)
// =====================================================================
function viewMonitoring() {
  const rows = currentConfiguration();
  const head = '<div class="page-top"></div>';   // no page heading: title and text are in the activity box
  const nav = `
  <div class="nav-buttons"><button class="btn" data-action="goto" data-page="select">← Back to comparison and selection</button>
    <button class="btn" data-action="new">Start new configuration</button></div>`;
  if (rows.some(r => !r.sel)) return `${head}<div class="card"><p class="warn-text">The configuration is incomplete: select a feasible alternative for every stage.</p></div>${nav}`;

  const req = deriveRequirements(state.answers);
  const ex = currentExecution(rows);
  const constraints = req.constraints.filter(isPipelineConstraint);
  // Stage-level constraints: the selected alternatives are feasible, so they satisfy them by construction.
  const stageConstraints = req.constraints.filter(c => !isPipelineConstraint(c));
  const previous = previousExecutions();
  return `${head}
  <div class="card">
    ${activityHead(6, 'Monitoring and Review', ``)}
    ${ex ? executionTables(ex)
         : `<p class="warn-text">Pipeline version v${state.version} has not been executed yet: generate its configuration file and run it with the framework.
            Its measurements will appear here.</p>`}

    <div class="execution-grid constraints-grid ${ex ? 'three' : ''}">
      <div class="subcard">
        <div class="subcard-head"><h3>Constraints on single stages</h3><span class="muted small">verified in alternative identification.</span></div>
        ${stageConstraints.length ? `<ul class="req-list pad">${stageConstraints.map(c => {
          const v = verifyStageConstraint(c, ex);
          return `<li>${esc(c.text)} <span class="verdict v-${v.status}">${v.text}</span></li>`;
        }).join('')}</ul>`
          : '<p class="muted small pad">None</p>'}
      </div>
      <div class="subcard">
        <div class="subcard-head"><h3>Constraints on the complete pipeline</h3><span class="muted small">verified on the measured values</span></div>
        ${constraints.length ? `<ul class="req-list pad">${constraints.map(c => {
          const v = verifyPipelineConstraint(c, ex);
          return `<li>${esc(c.text)} <span class="verdict v-${v.status}">${v.text}</span></li>`;
        }).join('')}</ul>` : '<p class="muted small pad">None</p>'}
      </div>
      ${ex ? diagnosticsBox(rows, ex, req) : ''}
    </div>

    ${ex ? revisionSection(rows, ex) : ''}
  </div>

  ${previous.length ? `
  <div class="card">
    <div class="card-head"><h2>Previous versions</h2><span class="muted">Measurements already applied to the expected performance</span></div>
    ${previous.map(p => `<details class="previous"><summary>Pipeline version v${p.version} · ${p.name}</summary>${executionTables(p)}</details>`).join('')}
  </div>` : ''}${nav}`;
}

// =====================================================================
// Events (one delegated listener per event type)
// =====================================================================
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const a = el.dataset.action;
  if (a === 'goto') { e.preventDefault(); goTo(el.dataset.page); }
  else if (a === 'activity') goToActivity(Number(el.dataset.n));
  else if (a === 'new') startNew();
  else if (a === 'scenario') loadScenario(el.dataset.id);
  else if (a === 'explore') { state.exploreStage = el.dataset.stage; render(); }
  else if (a === 'explore-alt') { state.exploreAlt = el.dataset.kind; render(); }
  else if (a === 'inspect') {
    const same = state.inspect && state.inspect.stage === el.dataset.stage && state.inspect.variant === el.dataset.variant;
    state.inspect = same ? null : { stage: el.dataset.stage, variant: el.dataset.variant };   // second click closes it
    $('#comparison').innerHTML = comparisonSection();
    // Bring the score breakdown into view.
    const detail = $('#comparison .score-detail');
    // Side by side it is already visible; on narrow screens it is below the stages.
    if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  else if (a === 'yaml') { state.showYaml = !state.showYaml; $('#selection').innerHTML = selectionSection(); }
  else if (a === 'download-yaml') downloadYaml();
  else if (a === 'derive') deriveVersion();
  else if (a === 'copy-yaml') {
    navigator.clipboard.writeText(yamlText(currentConfiguration()))
      .then(() => { el.textContent = 'Copied'; setTimeout(() => { el.textContent = 'Copy'; }, 1500); })
      .catch(() => { el.textContent = 'Copy failed'; });
  }
});

// Answers and selections update only the affected sections, so the page keeps its scroll position.
// Context fields only update the state (nothing else depends on them yet).
document.addEventListener('input', e => {
  const a = e.target.dataset.action;
  if (a === 'context') state.context[e.target.name] = e.target.value;
  if (a === 'rationale') state.rationale[e.target.dataset.stage] = e.target.value;
  if (a === 'param') {
    const st = state.params[e.target.dataset.stage] = state.params[e.target.dataset.stage] || {};
    st[e.target.name] = Number(e.target.value);
  }
  // Keep the configuration file in sync without re-rendering the field being edited.
  if ((a === 'rationale' || a === 'param') && state.showYaml) $('#yaml-panel').innerHTML = yamlPanel(currentConfiguration());
});

document.addEventListener('change', e => {
  const a = e.target.dataset.action;
  if (a === 'answer') {
    state.answers[e.target.name] = e.target.value;
    e.target.closest('fieldset').querySelectorAll('.option').forEach(l => l.classList.toggle('checked', l.contains(e.target)));
    $('#answered-count').textContent = answeredText();
    $('#requirements').innerHTML = requirementsPanel();
    $('#identification').innerHTML = identificationSection();
    // Comparison and selection are on their own page and are rendered from the state when it is opened.
  } else if (a === 'select') {
    // New variant: keep the current deployment if it is feasible for it, otherwise its first feasible one.
    const stage = e.target.dataset.stage;
    const row = compareStage(stage, deriveRequirements(state.answers)).find(r => r.variant === e.target.value);
    const current = (state.selections[stage] || '').split('-').pop();
    state.selections[stage] = (row.alts.find(a => a.deployment === current) || row.alt).kind;
    $('#selection').innerHTML = selectionSection();
  } else if (a === 'revise') {
    const { stage, variant, crit } = e.target.dataset;
    const byVariant = (state.draft[stage] = state.draft[stage] || {});
    (byVariant[variant] = byVariant[variant] || {})[crit] = e.target.value;
  } else if (a === 'deployment') {
    state.selections[e.target.dataset.stage] = e.target.value;
    $('#selection').innerHTML = selectionSection();
  } else if (a === 'model') {
    state.models[e.target.dataset.stage] = e.target.value;
    $('#selection').innerHTML = selectionSection();
  }
});

render();
