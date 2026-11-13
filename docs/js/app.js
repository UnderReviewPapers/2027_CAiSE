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
    requires: [...base.requires, ...((st.requires || {})[style] || [])],
    params: st.params || {},
    performance,
    provenance: PROVENANCE[base.variant]
  };
}

const alternativesOf = stageId => ALTERNATIVE_KINDS.map(k => getAlternative(stageId, k.kind));

// Requirements specification: answers -> constraints, preferences, resources.
// When several answers weigh the same criterion, the highest priority wins.
function deriveRequirements(answers) {
  const constraints = [], resources = new Set(), preferences = {};
  for (const q of QUESTIONS) {
    const opt = q.options.find(o => o.id === answers[q.id]);
    if (!opt) continue;
    (opt.constraints || []).forEach(c => constraints.push({ ...c, from: q.id }));
    (opt.resources || []).forEach(r => resources.add(r));
    for (const [crit, prio] of Object.entries(opt.preferences || {})) {
      if (!preferences[crit] || WEIGHTS[prio] > WEIGHTS[preferences[crit].priority]) {
        preferences[crit] = { priority: prio, weight: WEIGHTS[prio], from: q.id };
      }
    }
  }
  return { constraints, resources, preferences };
}

// Does an alternative have the characteristic required by a constraint?
function hasCharacteristic(alt, requires) {
  if (requires.capability) return alt.capabilities.includes(requires.capability);
  return Object.entries(requires).every(([dim, val]) => alt[dim] === val);
}

// Alternative identification (resources) + alternative comparison (constraints).
// status: 'unavailable' (missing resource) | 'excluded' (violates a constraint) | 'feasible'
function assessAlternative(alt, req) {
  const missing = alt.requires.filter(r => !req.resources.has(r));
  if (missing.length) return { status: 'unavailable', reasons: missing.map(r => 'Requires ' + RESOURCES[r].name.toLowerCase()) };
  const violated = req.constraints.filter(c => (c.stages.length === 0 || c.stages.includes(alt.stage)) && !hasCharacteristic(alt, c.requires));
  if (violated.length) return { status: 'excluded', reasons: violated.map(c => c.text) };
  return { status: 'feasible', reasons: [] };
}

// Weighted sum over the criteria the stage influences and the designer weighted.
function scoreAlternative(alt, preferences) {
  let sum = 0, weights = 0;
  for (const crit of STAGE_CRITERIA[alt.stage]) {
    const pref = preferences[crit];
    if (!pref || !alt.performance[crit]) continue;
    sum += LEVELS[alt.performance[crit]] * pref.weight;
    weights += pref.weight;
  }
  return weights ? sum / weights : null;
}

// Alternative comparison: every alternative with status, score and rank.
function compareStage(stageId, req) {
  const rows = alternativesOf(stageId).map(alt => {
    const a = assessAlternative(alt, req);
    return { alt, ...a, score: a.status === 'feasible' ? scoreAlternative(alt, req.preferences) : null };
  });
  const scores = rows.filter(r => r.score !== null).map(r => r.score);
  rows.forEach(r => { r.rank = r.score === null ? null : 1 + scores.filter(s => s > r.score + 1e-9).length; });
  return rows;
}

// Feasible alternatives of a stage, best first.
const rankedFeasible = rows => rows.filter(r => r.status === 'feasible').sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

// Configuration selection - selected alternative of a stage: the designer's choice if still
// feasible, otherwise the best-ranked feasible alternative (or null).
function selectedRow(stageId, rows) {
  const feasible = rankedFeasible(rows);
  return feasible.find(r => r.alt.kind === state.selections[stageId]) || feasible[0] || null;
}

// =====================================================================
// Actions
// =====================================================================
function goTo(page) { state.page = page; render(); window.scrollTo(0, 0); }

function loadScenario(id) {
  state.scenario = id;
  const sc = SCENARIOS[id];
  state.context = { ...sc.context, description: sc.description, example: sc.example };
  state.answers = { ...sc.answers };
  state.selections = {};
  goTo('config');
}

function startNew() { state.scenario = null; state.context = {}; state.answers = {}; state.selections = {}; goTo('config'); }

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
    <h1>Recommending the recommender</h1>
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
      <li><strong>Requirements specification</strong> — answers imply constraints, preferences over criteria and resources.</li>
      <li><strong>Alternative identification</strong> — alternatives realisable with the available resources.</li>
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
  const rationale = STAGE_ALTERNATIVES[alt.stage].rationale;
  const none = '<span class="muted">—</span>';
  return `
  <div class="alt-detail">
    <div class="alt-detail-head"><h3>${altLabel(alt)}</h3><div>${dimensionChips(alt)}</div></div>
    <p>${esc(alt.technique)}</p>
    <div class="alt-facts">
      <div><span class="fact-label">Framework component</span><code>${alt.component}</code>${alt.model ? ` <span class="muted">with</span> <code>${alt.model.id}</code>` : ''}</div>
      <div><span class="fact-label">Capabilities</span>${alt.capabilities.map(c => chip(CAPABILITIES[c])).join(' ') || none}</div>
      <div><span class="fact-label">Requires</span>${alt.requires.map(r => chip(RESOURCES[r].name)).join(' ') || none}</div>
    </div>
    <div class="label">Expected performance <span class="label-note">· ${alt.provenance} · higher is better</span></div>
    <ul class="perf-list">
      ${STAGE_CRITERIA[alt.stage].map(c => `
        <li title="${esc(rationale[c] || '')}">
          <span>${criterionById(c).name}</span>${levelBadge(alt.performance[c])}<span class="muted small">${LEVEL_NAMES[alt.performance[c]]}</span>
        </li>`).join('')}
    </ul>
    <details class="rationale"><summary>Why these estimates?</summary>
      <ul>${STAGE_CRITERIA[alt.stage].map(c => `<li><strong>${criterionById(c).name}.</strong> ${esc(rationale[c] || '')}</li>`).join('')}</ul>
    </details>
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
        ${todo('Questions and their mapping on constraints, criteria and resources are being revised.')}
      </div>
      <aside class="sticky">
        ${activityHead(2, 'Requirements specification', 'Constraints, preferences and resources implied by the answers.')}
        <div id="requirements">${requirementsPanel()}</div>
      </aside>
    </div>
  </section>

  <hr class="activity-divider">
  <section class="activity-section" id="identification">${identificationSection()}</section>

  <hr class="activity-divider">
  <section class="activity-section" id="comparison">${comparisonSection()}</section>`;
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
    }).join('')}</ul>

    <div class="label">Available resources</div>
    ${req.resources.size ? `<p>${[...req.resources].map(r => chip(RESOURCES[r].name)).join(' ')}</p>` : '<p class="muted">None yet</p>'}
  </div>`;
}

// ---------- Alternative identification ----------
function identificationSection() {
  const req = deriveRequirements(state.answers);
  const cell = alt => {
    const missing = alt.requires.filter(r => !req.resources.has(r));
    const tip = `${altLabel(alt)} — ${alt.component}` + (missing.length ? ` · requires ${missing.map(r => RESOURCES[r].name.toLowerCase()).join(', ')}` : ' · realisable');
    return `<td class="ef ${missing.length ? 'st-unavailable' : 'st-feasible'}" title="${esc(tip)}">${missing.length ? '–' : '✓'}</td>`;
  };
  return `
  ${activityHead(3, 'Alternative identification', 'For each stage, the alternatives that can be realised with the available resources, with their expected performance.')}
  <div class="card">
    <div class="legend"><span class="lg st-feasible">✓ realisable</span><span class="lg st-unavailable">– missing resource</span>
      <span class="muted small">Hover a cell for details</span></div>
    <div class="table-wrap"><table class="effects">
      <thead><tr><th>Stage</th><th></th>${VARIANTS.map(v => `<th>${variantLabel(v)}</th>`).join('')}</tr></thead>
      ${STAGES.map(s => `<tbody>${['internal', 'external'].map((d, i) => `
        <tr>${i === 0 ? `<th rowspan="2" class="ef-stage">${s.name}</th>` : ''}
          <td class="ef-dep">${d}</td>
          ${VARIANTS.map(v => cell(getAlternative(s.id, `${v}-${d}`))).join('')}
        </tr>`).join('')}</tbody>`).join('')}
    </table></div>
    <p class="small muted">Columns are alternative families. Expected performance values are the designer's estimates shown in the
       <a href="#" data-action="goto" data-page="space">design space</a>.</p>
    ${todo('Several implementations per family (e.g. collaborative filtering, content-based retrieval for traditional candidate selection).')}
  </div>`;
}

// ---------- Alternative comparison + configuration selection ----------
function comparisonSection() {
  const req = deriveRequirements(state.answers);
  const comparisons = STAGES.map(s => ({ stage: s, rows: compareStage(s.id, req) }));
  return `
  ${activityHead(4, 'Alternative comparison', 'Alternatives violating a hard constraint are excluded; the feasible ones are ranked by the weighted sum of their expected performance. Select one per stage.')}
  <div class="compare-grid">
    ${comparisons.map(({ stage, rows }) => stageComparison(stage, rows)).join('')}
  </div>

  <div class="subactivity">
    ${activityHead(5, 'Configuration selection', 'The alternative selected by the designer for each stage.')}
    ${selectionTable(comparisons)}
  </div>`;
}

function stageComparison(stage, rows) {
  const feasible = rankedFeasible(rows);
  const excluded = rows.filter(r => r.status === 'excluded');
  const unavailable = rows.filter(r => r.status === 'unavailable').length;
  const selected = selectedRow(stage.id, rows);
  return `
  <div class="card stage-compare">
    <div class="card-head"><h2>${stage.name}</h2><span class="muted">${feasible.length} feasible</span></div>
    ${feasible.length ? `<ul class="rank-list">${feasible.map(r => `
      <li>
        <label class="rank-row ${selected && selected.alt.kind === r.alt.kind ? 'selected' : ''}">
          <input type="radio" name="sel-${stage.id}" value="${r.alt.kind}" data-action="select" data-stage="${stage.id}"
                 ${selected && selected.alt.kind === r.alt.kind ? 'checked' : ''}>
          <span class="rank">#${r.rank}</span>
          <span class="rank-name">${altLabel(r.alt)}</span>
          ${scoreBar(r.score)}
        </label>
      </li>`).join('')}</ul>`
      : '<p class="warn-text">No feasible alternative: revise the answers or the available resources.</p>'}
    ${excluded.length ? `<details class="excluded"><summary>${excluded.length} excluded by constraints</summary>
      <ul>${excluded.map(r => `<li><span>${altLabel(r.alt)}</span><span class="muted">${esc(r.reasons.join('; '))}</span></li>`).join('')}</ul>
    </details>` : ''}
    ${unavailable ? `<p class="small muted">${unavailable} not realisable (see alternative identification)</p>` : ''}
  </div>`;
}

function selectionTable(comparisons) {
  return `
  <div class="card">
    <div class="table-wrap"><table class="alts">
      <thead><tr><th>Stage</th><th>Selected alternative</th><th>Component</th><th>Model</th><th>Rank</th></tr></thead>
      <tbody>${comparisons.map(({ stage, rows }) => {
        const r = selectedRow(stage.id, rows);
        if (!r) return `<tr><th>${stage.name}</th><td colspan="4" class="warn-text">No feasible alternative</td></tr>`;
        return `<tr><th>${stage.name}</th><td>${altLabel(r.alt)} <div>${dimensionChips(r.alt)}</div></td>
          <td><code>${r.alt.component}</code></td><td>${r.alt.model ? `<code>${r.alt.model.id}</code>` : '<span class="muted">—</span>'}</td>
          <td>#${r.rank}${r.rank !== 1 ? ' <span class="muted small">(not the best ranked)</span>' : ''}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    ${todo('Rationale for each choice, parameters (n_candidates, top_k) and pipeline-level constraint check.')}
    <div class="actions end">
      <button class="btn" data-action="yaml">Generate YAML configuration file</button>
      <button class="btn primary" data-action="goto" data-page="monitor"><span class="activity-num">6</span> Go to monitoring →</button>
    </div>
    <div id="yaml-panel"></div>
  </div>`;
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
  } else if (a === 'select') {
    state.selections[e.target.dataset.stage] = e.target.value;
    $('#comparison').innerHTML = comparisonSection();
  }
});

render();
