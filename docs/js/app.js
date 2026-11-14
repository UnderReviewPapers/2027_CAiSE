// =====================================================================
// Demo application: state, design logic and rendering.
// Plain JavaScript, no build step. Data lives in data.js.
//
// Pages:
//   home     landing page (load an example, start a configuration, explore the design space)
//   space    design space: pipeline, dimensions, alternatives of each stage
//   config   design activities 1-5 (scenario characterisation ... configuration selection)
//   monitor  design activity 6 (execution feedback)
// =====================================================================

const PAGES = [
  { id: 'home',    name: 'Home' },
  { id: 'space',   name: 'Design space' },
  { id: 'config',  name: 'Configuration' },
  { id: 'monitor', name: 'Monitoring' }
];

// ---------- State ----------
const state = {
  page: 'home',
  scenario: null,                     // 'movie' | 'healthcare' | null (custom)
  context: {},                        // CONTEXT_FIELDS id -> text
  answers: {},                        // questionId -> optionId
  selections: {},                     // stageId -> alternative kind chosen by the designer
  models: {},                         // stageId -> language model id chosen by the designer
  params: {},                         // stageId -> { parameter: value } set by the designer
  inspect: null,                      // alternative comparison: { stage, variant } whose score is shown
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
    params: st.params || {},
    performance,
    provenance: PROVENANCE
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
  if (c.criterion) return !alt.performance[c.criterion] || LEVELS[alt.performance[c.criterion]] >= LEVELS[c.min]; // threshold
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

// ---------- Preferences ----------
// Contribution of each criterion the stage influences: level, value and weight.
function scoreBreakdown(alt, preferences) {
  return STAGE_CRITERIA[alt.stage].map(crit => {
    const level = alt.performance[crit], pref = preferences[crit];
    return { crit, level, value: LEVELS[level], weight: pref ? pref.weight : 0, priority: pref ? pref.priority : null };
  });
}

// Weighted sum over the weighted criteria, normalised by the total weight.
function scoreAlternative(alt, preferences) {
  const parts = scoreBreakdown(alt, preferences).filter(p => p.weight && p.level);
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
const selectedParams = (stageId, alt) => ({ ...alt.params, ...(state.params[stageId] || {}) });

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
  goTo('config');
}

function startNew() { state.scenario = null; state.context = {}; state.answers = {}; resetDesign(); goTo('config'); }

// Forget the designer's choices of a previous configuration.
function resetDesign() { state.selections = {}; state.models = {}; state.params = {}; state.inspect = null; }

// =====================================================================
// Rendering
// =====================================================================
function render() {
  $('#nav').innerHTML = PAGES.map(p =>
    `<button class="nav-link ${p.id === state.page ? 'active' : ''}" data-action="goto" data-page="${p.id}">${p.name}</button>`).join('');
  const views = { home: viewHome, space: viewDesignSpace, config: viewConfiguration, monitor: viewMonitoring };
  $('#view').innerHTML = views[state.page]();
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

function pageHead(eyebrow, title, text) {
  return `<section class="page-head"><div>
    <div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${text}</p>
  </div></section>`;
}

// Numbered section header of a design activity.
function activityHead(n, title, text) {
  return `<div class="activity-head"><span class="activity-num">${n}</span><div><h2>${title}</h2><p class="muted">${text}</p></div></div>`;
}

function todo(text) { return `<div class="todo-box">${chip('to do', 'todo')} ${text}</div>`; }

// =====================================================================
// Page: Home
// =====================================================================
function viewHome() {
  return `
  <section class="hero">
    <div class="eyebrow">Model-based design of recommender systems</div>
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
        <div>
          <h4>Start a new configuration</h4>
          <p class="muted">Characterise your own scenario by answering the questions.</p>
        </div>
        <button class="btn primary" data-action="new">Start new configuration →</button>
      </div>
      <div class="start-row">
        <div>
          <h4>Explore the design space</h4>
          <p class="muted">Browse the pipeline stages and every alternative the framework implements.</p>
        </div>
        <button class="btn" data-action="goto" data-page="space">Explore the design space →</button>
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
          <div class="example-query">
            <span class="fact-label">Example query</span>
            <blockquote>“${esc(sc.example)}”</blockquote>
          </div>
        </div>`).join("")}
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Design activities</h2></div>
    <ol class="activity-list">
      <li><strong>Scenario characterisation</strong> — the designer answers predefined questions.</li>
      <li><strong>Requirements specification</strong> — answers imply hard constraints and preferences over criteria.</li>
      <li><strong>Alternative identification</strong> — alternatives whose required resources are available.</li>
      <li><strong>Alternative comparison</strong> — exclude those violating constraints, rank the feasible ones.</li>
      <li><strong>Configuration selection</strong> — the designer chooses one alternative per stage; configuration file.</li>
      <li><strong>Execution feedback</strong> — measurements validate or revise the design.</li>
    </ol>
  </section>`;
}

// =====================================================================
// Page: Design space
// =====================================================================
function viewDesignSpace() {
  const stage = stageById(state.exploreStage);
  return `
  ${pageHead('Design space', 'The recommendation pipeline',
    `A recommender system is designed as a pipeline of <strong>five stages</strong>. Each stage can be implemented by a
     traditional technique or by a language model, small or large, deployed internally or externally and executed directly
     or as an agent. This page shows every alternative the framework implements.`)}

  <section class="card">
    <div class="card-head"><h2>Design-space dimensions</h2></div>
    <div class="dims">
      <div><h4>Component type</h4><p>Traditional technique, small LM or large LM. SLMs need fewer resources; LLMs handle complex tasks at higher time and cost.</p></div>
      <div><h4>Deployment</h4><p>Internal (organisation-controlled infrastructure) or external provider. Decided per stage, it determines where user data flow.</p></div>
      <div><h4>Execution</h4><p>For LMs: direct invocation, or agentic execution that can call tools such as Text-to-SQL on the catalogue.</p></div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Stages and alternatives</h2><span class="muted">Select a stage, then an alternative</span></div>
    <div class="pipeline">
      ${STAGES.map((s, i) => `
        ${i ? '<span class="arrow" aria-hidden="true">→</span>' : ''}
        <button class="stage-box ${s.id === stage.id ? 'selected' : ''}" data-action="explore" data-stage="${s.id}">
          <span class="stage-idx">Stage ${i + 1}</span>
          <strong>${s.name}</strong>
          <small>${s.task} → <em>${s.output}</em></small>
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
    ${variantTable(stage.id)}
  </section>

  <div class="nav-buttons"><button class="btn" data-action="goto" data-page="home">← Home</button>
    <button class="btn primary" data-action="new">Start new configuration →</button></div>`;
}

// Design-space matrix of a stage: rows = type + execution, columns = deployment.
function altMatrix(stageId) {
  const cell = (variant, deployment) => {
    const alt = getAlternative(stageId, `${variant}-${deployment}`);
    return `<button class="matrix-cell ${alt.kind === state.exploreAlt ? 'selected' : ''}" data-action="explore-alt" data-kind="${alt.kind}">
              <code>${alt.component}</code>
              ${alt.model ? `<small>${alt.model.name}</small>` : ''}
            </button>`;
  };
  return `
  <div class="label">Design space · ${ALTERNATIVE_KINDS.length} alternatives</div>
  <div class="matrix">
    <div></div><div class="matrix-col">Internal</div><div class="matrix-col">External</div>
    ${VARIANTS.map(v => `<div class="matrix-row">${variantLabel(v)}</div>${cell(v, 'internal')}${cell(v, 'external')}`).join('')}
  </div>
  <p class="small muted">Only the combinations implemented in the framework are shown: traditional techniques have no agentic
     execution, and agentic execution is available with the LLM.</p>`;
}

// Details of one alternative: characteristics, component, requirements, expected performance.
function altDetail(alt) {
  const none = '<span class="muted">—</span>';
  return `
  <div class="alt-detail">
    <div class="alt-detail-head"><h3>${altLabel(alt)}</h3><div>${dimensionChips(alt)}</div></div>
    <p>${esc(alt.technique)}</p>
    <div class="alt-facts">
      <div><span class="fact-label">Framework component</span><code>${alt.component}</code>${alt.model ? ` <span class="muted">with</span> <code>${alt.model.id}</code>` : ''}</div>
      <div><span class="fact-label">Capabilities</span>${alt.capabilities.map(c => chip(CAPABILITIES[c])).join(' ') || none}</div>
      <div><span class="fact-label">Required resources</span>${alt.requiredResources.map(r => chip(REQUIRED_RESOURCES[r].name)).join(' ') || none}</div>
    </div>
    <div class="label">Expected performance <span class="label-note">· ${alt.provenance.kind} · higher is better</span></div>
    <ul class="perf-list">
      ${STAGE_CRITERIA[alt.stage].map(c => `
        <li>
          <span>${criterionById(c).name}</span>${levelBadge(alt.performance[c])}<span class="muted small">${LEVEL_NAMES[alt.performance[c]]}</span>
        </li>`).join('')}
    </ul>
  </div>`;
}

// Side-by-side comparison of the variants (deployment does not change the estimates).
function variantTable(stageId) {
  const alts = VARIANTS.map(v => getAlternative(stageId, `${v}-internal`));
  return `
  <details class="rationale compare">
    <summary>Compare expected performance across variants</summary>
    <div class="table-wrap flat"><table class="alts">
      <thead><tr><th>Criterion</th>${alts.map(a => `<th>${variantLabel(a.variant)}</th>`).join('')}</tr></thead>
      <tbody>${STAGE_CRITERIA[stageId].map(c => `
        <tr><th>${criterionById(c).name}</th>${alts.map(a => `<td>${levelBadge(a.performance[c])}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table></div>
    <p class="small muted pad">Internal and external deployment share the same estimates; deployment matters for privacy constraints and required resources.</p>
  </details>`;
}

// =====================================================================
// Page: Configuration (design activities 1-5)
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
    <div class="card-head"><h2>Context</h2><span class="muted">The application the recommender is designed for</span></div>
    <div class="field-grid">${CONTEXT_FIELDS.map(field).join('')}</div>
  </div>`;
}

function viewConfiguration() {
  const sc = state.scenario && SCENARIOS[state.scenario];
  return `
  ${pageHead(sc ? `Example loaded · ${sc.name}` : 'New configuration', 'Configuration',
    `${sc ? 'Answers are loaded from the example; change any of them to see the effect.' : 'Answer the questions to characterise your application.'}
     The design activities below update as you answer.`)}

  <section class="activity-section">
    <div class="two-col">
      <div>
        ${activityHead(1, 'Scenario characterisation', 'The designer answers each question by choosing one option.')}
        ${contextCard()}
        <p class="small muted" id="answered-count">${answeredText()}</p>
        ${QUESTION_GROUPS.map(g => `
          <div class="card">
            <div class="card-head"><h2>${g.name}</h2></div>
            ${QUESTIONS.filter(q => q.group === g.id).map(questionBlock).join('')}
          </div>`).join('')}
      </div>
      <aside class="sticky">
        ${activityHead(2, 'Requirements specification', 'Hard constraints and preferences implied by the answers.')}
        <div id="requirements">${requirementsPanel()}</div>
      </aside>
    </div>
  </section>

  <hr class="activity-divider">
  <section class="activity-section" id="identification">${identificationSection()}</section>

  <hr class="activity-divider">
  <section class="activity-section" id="comparison">${comparisonSection()}</section>

  <hr class="activity-divider">
  <section class="activity-section" id="selection">${selectionSection()}</section>`;
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
      return `<li ${p ? `title="From: ${esc(qText(p.from))}"` : ''}><span>${c.name} <span class="muted small">· ${c.family}</span></span>
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
  const excluded = identified.filter(({ rows }) => rows.some(r => !r.feasible));
  return `
  ${activityHead(3, 'Alternative identification', `Each alternative is <span class="lg st-feasible">✓ feasible</span> or
    <span class="lg st-excluded">✗ excluded</span> if it violates a hard constraint. Hover a cell for the reason.`)}
  <div class="card">
    <div class="table-wrap"><table class="effects">
      <thead><tr><th>Stage</th><th></th>${VARIANTS.map(v => `<th>${variantLabel(v)}</th>`).join('')}</tr></thead>
      ${identified.map(({ stage, rows }) => `<tbody>${['internal', 'external'].map((d, i) => `
        <tr>${i === 0 ? `<th rowspan="2" class="ef-stage">${stage.name}</th>` : ''}
          <td class="ef-dep">${d}</td>
          ${VARIANTS.map(v => cell(rows.find(r => r.alt.kind === `${v}-${d}`))).join('')}
        </tr>`).join('')}</tbody>`).join('')}
    </table></div>
    ${excluded.length ? `<details class="excluded"><summary>Excluded alternatives and violated constraints</summary>
      <div class="excluded-grid">${excluded.map(({ stage, rows }) => `<div><div class="label">${stage.name}</div><ul>${rows.filter(r => !r.feasible).map(r =>
        // one violated constraint: on the same line as the alternative; several: one per line below it
        r.reasons.length === 1
          ? `<li class="inline"><span>${altLabel(r.alt)}</span> <span class="muted">${esc(r.reasons[0])}</span></li>`
          : `<li><span>${altLabel(r.alt)}</span>${r.reasons.map(x => `<span class="muted">${esc(x)}</span>`).join('')}</li>`).join('')}</ul></div>`).join('')}
      </div>
    </details>` : ''}
    <p class="small muted">Columns are alternative families. Their characteristics and expected performance are shown in the
       <a href="#" data-action="goto" data-page="space">design space</a>.</p>
    ${todo('Several implementations per family (e.g. collaborative filtering, content-based retrieval for traditional candidate selection).')}
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
  ${activityHead(4, 'Alternative comparison', 'Feasible alternatives ranked by the weighted sum of their expected performance. Click one to see how its score is obtained.')}
  <div class="compare-grid">
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
  ${insRow ? scoreDetail(ins.stage, insRow, req) : ''}`;
}

// How the score of an alternative is obtained: estimates, weights and their provenance.
function scoreDetail(stage, row, req) {
  const alt = row.alt;
  const parts = scoreBreakdown(alt, req.preferences);
  return `
  <div class="card score-detail">
    <div class="card-head"><h2>${stage.name} · ${variantLabel(row.variant)}</h2><span>${deploymentChips(row.alts)}</span></div>
    <div class="alt-summary">
      <div><span class="fact-label">Technique</span>${esc(alt.technique)}</div>
      ${alt.model ? `<div><span class="fact-label">Language model</span>${alt.model.name}</div>` : ''}
    </div>
    <div class="score-grid">
    <div class="table-wrap flat"><table class="alts">
      <thead><tr><th>Criterion</th><th>Expected performance</th><th>Weight</th><th>Weighted value</th></tr></thead>
      <tbody>${parts.map(p => `
        <tr class="${p.weight ? '' : 'muted'}"><th>${criterionById(p.crit).name}</th><td>${levelBadge(p.level)} ${p.level ? `<span class="muted small">= ${p.value}</span>` : ''}</td>
          <td>${p.weight ? `${p.weight} <span class="muted small">(${p.priority})</span>` : 'not weighted'}</td>
          <td>${p.weight && p.level ? (p.value * p.weight).toFixed(2) : '—'}</td></tr>`).join('')}
        <tr class="total-row"><th>Score</th><td colspan="2" class="muted small">sum of weighted values / total weight</td>
          <td>${row.score === null ? '—' : row.score.toFixed(3)}</td></tr>
      </tbody>
    </table></div>
    <div>
      <div class="label">Provenance of the expected performance</div>
      <dl class="provenance">
        <dt>Kind</dt><dd>${alt.provenance.kind}</dd>
        <dt>Method</dt><dd>${alt.provenance.method}</dd>
      </dl>
    </div>
    </div>
  </div>`;
}

// ---------- Activity 5: Configuration selection ----------
function selectionSection() {
  const req = deriveRequirements(state.answers);
  const rows = STAGES.map(s => {
    const ranked = compareStage(s.id, req);
    return { stage: s, ranked, sel: selectedRow(s.id, ranked) };
  });
  return `
  ${activityHead(5, 'Configuration selection', 'For each stage, the designer selects one feasible alternative (by default the best ranked), its language model and its parameters. Constraints on the complete pipeline are checked on the resulting configuration.')}
  <div class="card">
    <div class="table-wrap"><table class="alts selection">
      <thead><tr><th>Stage</th><th>Alternative</th><th>Deployment</th><th>Language model</th><th>Parameters</th></tr></thead>
      <tbody>${rows.map(({ stage, ranked, sel }) => {
        if (!sel) return `<tr><th>${stage.name}</th><td colspan="4" class="warn-text">No feasible alternative</td></tr>`;
        const alt = sel.alt, model = selectedModel(stage.id, alt), params = selectedParams(stage.id, alt);
        return `<tr><th>${stage.name}</th>
          <td><select data-action="select" data-stage="${stage.id}">${ranked.map(r =>
              `<option value="${r.variant}" ${r.variant === sel.variant ? 'selected' : ''}>${rankText(r)} ${variantLabel(r.variant)}${r.score === null ? '' : ' · ' + r.score.toFixed(3)}</option>`).join('')}
            </select>
            ${sel.rank !== null && sel.rank !== 1 ? '<div class="muted small">not the best ranked</div>' : ''}</td>
          <td><select data-action="deployment" data-stage="${stage.id}">${sel.alts.map(a =>
              `<option value="${a.kind}" ${a.kind === alt.kind ? 'selected' : ''}>${DIMENSIONS.deployment.values[a.deployment]}</option>`).join('')}</select></td>
          <td>${alt.models.length ? `<select data-action="model" data-stage="${stage.id}">${alt.models.map(m =>
              `<option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
              <div><code class="small">${model.id}</code></div>` : '<span class="muted">—</span>'}</td>
          <td>${Object.keys(params).length ? Object.entries(params).map(([k, v]) => `
              <label class="param"><code>${k}</code><input type="number" min="1" value="${v}" data-action="param" data-stage="${stage.id}" name="${k}"></label>`).join('')
              : '<span class="muted">—</span>'}</td></tr>`;
      }).join('')}</tbody>
    </table></div>

    <div class="label">Constraints on the complete pipeline</div>
    ${pipelineConstraints(req)}
    ${todo('Rationale for each choice.')}
    <div class="actions end">
      <button class="btn" data-action="yaml">Generate YAML configuration file</button>
      <button class="btn primary" data-action="goto" data-page="monitor"><span class="activity-num">6</span> Go to monitoring →</button>
    </div>
    <div id="yaml-panel"></div>
  </div>`;
}

// Pipeline-level constraints (e.g. maximum response time) are checked on the complete configuration.
// With qualitative estimates the pipeline value cannot be computed: they are verified on measured values.
function pipelineConstraints(req) {
  const list = req.constraints.filter(isPipelineConstraint);
  if (!list.length) return '<p class="muted small">None</p>';
  return `<ul class="req-list">${list.map(c => `<li>${esc(c.text)}
      <div class="muted small">Cannot be verified yet: expected performance is only estimated on a qualitative scale.</div></li>`).join('')}</ul>
    ${todo('Verify the pipeline-level constraints with the measured values of execution feedback.')}`;
}

// =====================================================================
// Page: Monitoring (design activity 6: execution feedback)
// =====================================================================
function viewMonitoring() {
  return `
  ${pageHead('Design activity 6', 'Monitoring',
    'Executing the selected configuration closes the design loop.')}
  <div class="card">
    ${activityHead(6, 'Execution feedback',
      'Execution results provide evidence for evaluating the selected configuration and refining previous assessments.')}
    ${todo('Measured criteria from framework executions (framework/out/computed_results), per stage and for the whole pipeline, compared with the expected performance.')}
    ${todo('Measured values replace the estimates (provenance: measured) for subsequent comparisons.')}
    ${todo('Derive a new pipeline version: revise stage selections or answers.')}
  </div>
  <div class="nav-buttons"><button class="btn" data-action="goto" data-page="config">← Back to configuration</button>
    <button class="btn" data-action="new">Start new configuration</button></div>`;
}

// =====================================================================
// Events (one delegated listener per event type)
// =====================================================================
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const a = el.dataset.action;
  if (a === 'goto') { e.preventDefault(); goTo(el.dataset.page); }
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
    if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  else if (a === 'yaml') $('#yaml-panel').innerHTML = todo('Generate and download the YAML file in the format of framework/config/schema.yaml.');
});

// Answers and selections update only the affected sections, so the page keeps its scroll position.
// Context fields only update the state (nothing else depends on them yet).
document.addEventListener('input', e => {
  if (e.target.dataset.action === 'context') state.context[e.target.name] = e.target.value;
});

document.addEventListener('change', e => {
  const a = e.target.dataset.action;
  if (a === 'answer') {
    state.answers[e.target.name] = e.target.value;
    e.target.closest('fieldset').querySelectorAll('.option').forEach(l => l.classList.toggle('checked', l.contains(e.target)));
    $('#answered-count').textContent = answeredText();
    $('#requirements').innerHTML = requirementsPanel();
    $('#identification').innerHTML = identificationSection();
    $('#comparison').innerHTML = comparisonSection();
    $('#selection').innerHTML = selectionSection();
  } else if (a === 'select') {
    // New variant: keep the current deployment if it is feasible for it, otherwise its first feasible one.
    const stage = e.target.dataset.stage;
    const row = compareStage(stage, deriveRequirements(state.answers)).find(r => r.variant === e.target.value);
    const current = (state.selections[stage] || '').split('-').pop();
    state.selections[stage] = (row.alts.find(a => a.deployment === current) || row.alt).kind;
    $('#selection').innerHTML = selectionSection();
  } else if (a === 'deployment') {
    state.selections[e.target.dataset.stage] = e.target.value;
    $('#selection').innerHTML = selectionSection();
  } else if (a === 'model') {
    state.models[e.target.dataset.stage] = e.target.value;
    $('#selection').innerHTML = selectionSection();
  } else if (a === 'param') {
    const st = state.params[e.target.dataset.stage] = state.params[e.target.dataset.stage] || {};
    st[e.target.name] = Number(e.target.value);
  }
});

render();
