// =====================================================================
// Demo application: state, methodology logic and rendering.
// Plain JavaScript, no build step. Data lives in data.js.
// =====================================================================

const STEPS = [
  { id: 1, name: 'Pipeline',      sub: 'Design space' },
  { id: 2, name: 'Questions',     sub: 'Scenario & requirements' },
  { id: 3, name: 'Assessment',    sub: 'Compare & select' },
  { id: 4, name: 'Configuration', sub: 'File & feedback' }
];

// ---------- State ----------
const state = {
  step: 1,
  scenario: null,        // 'movie' | 'healthcare' | null (custom)
  answers: {},           // questionId -> optionId
  exploreStage: 'input', // stage shown in the design-space explorer (step 1)
  exploreAlt: 'llm-agentic-external' // alternative shown in the explorer (step 1)
};

// ---------- Small helpers ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stageById = id => STAGES.find(s => s.id === id);
const criterionById = id => CRITERIA.find(c => c.id === id);
// Short names, e.g. "SLM · agentic · internal" and "SLM agentic".
const variantLabel = v => v === 'traditional' ? 'Traditional' : v.replace('slm', 'SLM').replace('llm', 'LLM').replace('-', ' ');
const altLabel = a => `${variantLabel(a.variant)} · ${a.deployment}`;

// =====================================================================
// Methodology logic
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

// Alternative identification + comparison (feasibility part).
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

// Stage-level comparison: every alternative with status, score and rank.
function compareStage(stageId, req) {
  const rows = alternativesOf(stageId).map(alt => {
    const a = assessAlternative(alt, req);
    return { alt, ...a, score: a.status === 'feasible' ? scoreAlternative(alt, req.preferences) : null };
  });
  const scores = rows.filter(r => r.score !== null).map(r => r.score);
  rows.forEach(r => { r.rank = r.score === null ? null : 1 + scores.filter(s => s > r.score + 1e-9).length; });
  return rows;
}

// =====================================================================
// Actions
// =====================================================================
function goTo(step) { state.step = step; render(); window.scrollTo(0, 0); }

function loadScenario(id) {
  state.scenario = id;
  state.answers = { ...SCENARIOS[id].answers };
  goTo(2);
}

function startCustom() { state.scenario = null; state.answers = {}; goTo(2); }

function resetAll() { state.scenario = null; state.answers = {}; state.exploreStage = 'input'; goTo(1); }

// =====================================================================
// Rendering
// =====================================================================
function render() {
  renderStepper();
  const views = { 1: viewPipeline, 2: viewQuestions, 3: viewAssessment, 4: viewConfiguration };
  $('#view').innerHTML = views[state.step]();
}

function renderStepper() {
  $('#stepper').innerHTML = STEPS.map(s => `
    <button class="step ${s.id === state.step ? 'active' : ''} ${s.id < state.step ? 'done' : ''}" data-action="goto" data-step="${s.id}">
      <span class="step-num">${s.id}</span>
      <span class="step-text"><strong>${s.name}</strong><small>${s.sub}</small></span>
    </button>`).join('');
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
  return `<span class="level lv-${level}" title="${LEVEL_NAMES[level]} (${LEVELS[level]})">
            <span class="bar"><span style="width:${LEVELS[level] * 100}%"></span></span>${level}</span>`;
}

// Page header: methodology activity (eyebrow), title, text and step counter.
function pageHead(eyebrow, title, text, extra = '') {
  return `<section class="page-head">
    <div>
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      <p>${text}</p>
      ${extra}
    </div>
    <span class="step-counter">Step ${state.step} of ${STEPS.length}</span>
  </section>`;
}

function navButtons(prev, next) {
  return `<div class="nav-buttons">
    ${prev ? `<button class="btn" data-action="goto" data-step="${prev.step}">← ${prev.label}</button>` : '<span></span>'}
    ${next ? `<button class="btn primary" data-action="goto" data-step="${next.step}">${next.label} →</button>` : ''}
  </div>`;
}

// ---------- Step 1: pipeline and design space ----------
function viewPipeline() {
  const stage = stageById(state.exploreStage);
  return `
  ${pageHead('Design space', 'The recommendation pipeline',
    `A recommender system is designed as a pipeline of <strong>five stages</strong>. Each stage can be implemented by a
     traditional technique or by a language model, small or large, deployed internally or externally and executed directly
     or as an agent. The methodology helps the designer choose, stage by stage, the alternatives that satisfy the
     <strong>constraints</strong> of the application and best fit its <strong>priorities</strong>, and produces a
     configuration file that the framework executes.`)}

  <section class="card">
    <div class="card-head"><h2>Design-space dimensions</h2></div>
    <div class="dims">
      <div><h4>Component type</h4><p>Traditional technique, small LM or large LM. SLMs need fewer resources; LLMs handle complex tasks at higher time and cost.</p></div>
      <div><h4>Deployment</h4><p>Internal (organisation-controlled infrastructure) or external provider. Decided per stage, it determines where user data flow.</p></div>
      <div><h4>Execution</h4><p>For LMs: direct invocation, or agentic execution that can call tools such as Text-to-SQL on the catalogue.</p></div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Stages and alternatives</h2><span class="muted">Select a stage to explore its alternatives</span></div>
    <div class="pipeline">
      ${STAGES.map((s, i) => `
        ${i ? '<span class="arrow" aria-hidden="true">→</span>' : ''}
        <button class="stage-box ${s.id === stage.id ? 'selected' : ''}" data-action="explore" data-stage="${s.id}">
          <span class="stage-idx">${i + 1}</span>
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

  <section class="card start">
    <div class="card-head"><h2>Start a design</h2><span class="muted">Load one of the paper's scenarios or answer the questions yourself</span></div>
    <div class="start-grid">
      ${Object.entries(SCENARIOS).map(([id, sc]) => `
        <div class="start-option">
          <h4>${sc.name}</h4>
          <p>${sc.description}</p>
          <blockquote>“${esc(sc.example)}”</blockquote>
          <button class="btn" data-action="scenario" data-id="${id}">Load example</button>
        </div>`).join('')}
      <div class="start-option highlight">
        <h4>Your own application</h4>
        <p>Answer the guided questions from scratch and watch how each answer shapes the feasible alternatives.</p>
        <button class="btn primary" data-action="custom">Start configuration →</button>
      </div>
    </div>
  </section>`;
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
    ${VARIANTS.map(v => `
      <div class="matrix-row">${variantLabel(v)}</div>
      ${cell(v, 'internal')}${cell(v, 'external')}`).join('')}
  </div>
  <p class="small muted">Only the combinations implemented in the framework are shown: traditional techniques have no agentic execution, and agentic execution is available with the LLM.</p>`;
}

// Details of one alternative: characteristics, component, requirements, expected performance.
function altDetail(alt) {
  const rationale = STAGE_ALTERNATIVES[alt.stage].rationale;
  const none = '<span class="muted">—</span>';
  return `
  <div class="alt-detail">
    <div class="alt-detail-head">
      <h3>${altLabel(alt)}</h3>
      <div>${dimensionChips(alt)}</div>
    </div>
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

// ---------- Step 2: questions + live effect on the design space ----------
function viewQuestions() {
  const sc = state.scenario && SCENARIOS[state.scenario];
  const answered = QUESTIONS.filter(q => state.answers[q.id]).length;
  return `
  <div class="two-col">
    <div>
      ${pageHead('Scenario characterisation · Requirements specification', 'Questions',
        `${sc ? `Answers loaded from the <strong>${sc.name}</strong> scenario. You can change any of them.`
              : 'Answer each question by choosing one option.'}
         Each answer implies hard constraints, preferences over criteria or available resources.`,
        `<div class="progress"><span id="answered-bar" style="width:${100 * answered / QUESTIONS.length}%"></span></div>
         <p class="small muted" id="answered-count">${answered} of ${QUESTIONS.length} questions answered</p>`)}
      ${QUESTION_GROUPS.map(g => `
        <section class="card">
          <div class="card-head"><h2>${g.name}</h2></div>
          ${QUESTIONS.filter(q => q.group === g.id).map(questionBlock).join('')}
        </section>`).join('')}
      ${navButtons({ step: 1, label: 'Pipeline' }, { step: 3, label: 'Assessment' })}
    </div>
    <aside class="sticky" id="effects">${effectsPanel()}</aside>
  </div>`;
}

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

// Right-hand panel: effect of the answers on the alternatives of each stage.
function effectsPanel() {
  const req = deriveRequirements(state.answers);
  // One cell per alternative: score if feasible, ✕ if excluded, – if not realisable.
  const cell = r => {
    const text = r.status === 'excluded' ? '✕' : r.status === 'unavailable' ? '–' : r.score !== null ? r.score.toFixed(2) : '✓';
    const tip = `${altLabel(r.alt)}: ` + (r.reasons.join('; ') || (r.score !== null ? `score ${r.score.toFixed(3)}, rank ${r.rank}` : 'feasible, no weighted criteria yet'));
    return `<td class="ef st-${r.status} ${r.rank === 1 ? 'st-best' : ''}" title="${esc(tip)}">${text}</td>`;
  };
  return `
  <section class="card">
    <div class="card-head"><h2>Effect on the alternatives</h2><span class="muted">Hover a cell for details</span></div>
    <div class="legend">
      <span class="lg st-best">best ranked</span><span class="lg st-feasible">feasible (score)</span>
      <span class="lg st-excluded">✕ excluded by constraint</span><span class="lg st-unavailable">– missing resource</span>
    </div>
    <div class="table-wrap"><table class="effects">
      <thead><tr><th>Stage</th><th></th>${VARIANTS.map(v => `<th>${variantLabel(v)}</th>`).join('')}</tr></thead>
      ${STAGES.map(s => {
        const rows = compareStage(s.id, req);
        const byKind = Object.fromEntries(rows.map(r => [r.alt.kind, r]));
        return `<tbody>${['internal', 'external'].map((d, i) => `
          <tr>${i === 0 ? `<th rowspan="2" class="ef-stage">${s.name}</th>` : ''}
            <td class="ef-dep">${d === 'internal' ? 'int.' : 'ext.'}</td>
            ${VARIANTS.map(v => cell(byKind[`${v}-${d}`])).join('')}
          </tr>`).join('')}</tbody>`;
      }).join('')}
    </table></div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Derived requirements</h2></div>
    <div class="label">Hard constraints</div>
    ${req.constraints.length ? `<ul class="req-list">${req.constraints.map(c => `<li>${esc(c.text)}</li>`).join('')}</ul>` : '<p class="muted">None yet</p>'}
    <div class="label">Preferences</div>
    ${Object.keys(req.preferences).length ? `<ul class="pref-list">${CRITERIA.filter(c => req.preferences[c.id]).map(c => `
      <li><span>${c.name}</span><span class="prio prio-${req.preferences[c.id].priority}">${req.preferences[c.id].priority} · ${req.preferences[c.id].weight}</span></li>`).join('')}</ul>` : '<p class="muted">None yet</p>'}
    <div class="label">Available resources</div>
    ${req.resources.size ? `<p>${[...req.resources].map(r => chip(RESOURCES[r].name)).join(' ')}</p>` : '<p class="muted">None yet</p>'}
  </section>`;
}

// ---------- Step 3: assessment (placeholder) ----------
function viewAssessment() {
  return `
  ${pageHead('Alternative comparison · Configuration selection', 'Assessment',
    `The alternatives that violate a hard constraint are excluded, the feasible ones are ranked per stage with a weighted
     sum of their expected performance, and the designer selects and justifies one alternative per stage.`)}
  ${placeholder('Stage-level comparison', 'For each stage: estimates × weights, weighted-sum score and rank of feasible alternatives; excluded ones with the violated constraint.')}
  ${placeholder('Stage selection', 'The designer chooses one alternative per stage (default: best ranked), its language model and parameters, and writes a short rationale.')}
  ${placeholder('Pipeline-level check', 'The complete configuration is checked against the hard constraints (and pipeline-level thresholds, if any).')}
  ${navButtons({ step: 2, label: 'Questions' }, { step: 4, label: 'Configuration' })}`;
}

// ---------- Step 4: configuration file + feedback (placeholder) ----------
function viewConfiguration() {
  return `
  ${pageHead('Configuration file · Execution feedback', 'Configuration',
    'The selected pipeline version is expressed as a machine-readable configuration file, executed by the framework.')}
  ${placeholder('Configuration file', 'YAML file in the format of framework/config/schema.yaml, with copy and download buttons.')}
  ${placeholder('Design rationale', 'Answers, derived requirements and stage selections, kept traceable to each other.')}
  <section class="card">
    <div class="card-head"><h2>Next</h2></div>
    <div class="actions">
      <button class="btn" data-action="goto" data-step="2">↺ Reconfigure <small>(new pipeline version from current answers)</small></button>
      <button class="btn" data-action="monitor">Monitoring <small>(execution feedback)</small></button>
      <button class="btn primary" data-action="reset">Start a new configuration</button>
    </div>
    <div id="monitor-panel"></div>
  </section>`;
}

function placeholder(title, text) {
  return `<section class="card placeholder"><div class="card-head"><h2>${title}</h2>${chip('to do', 'todo')}</div><p>${text}</p></section>`;
}

// =====================================================================
// Events (one delegated listener per event type)
// =====================================================================
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'goto') goTo(Number(el.dataset.step));
  else if (a === 'explore') { state.exploreStage = el.dataset.stage; render(); }
  else if (a === 'explore-alt') { state.exploreAlt = el.dataset.kind; render(); }
  else if (a === 'scenario') loadScenario(el.dataset.id);
  else if (a === 'custom') startCustom();
  else if (a === 'reset') resetAll();
  else if (a === 'monitor') $('#monitor-panel').innerHTML =
    placeholder('Monitoring', 'Measured criteria from framework executions (framework/out/computed_results) compared with the expected performance, to validate or revise the design.');
});

document.addEventListener('change', e => {
  if (e.target.dataset.action !== 'answer') return;
  state.answers[e.target.name] = e.target.value;
  // Update only what changes, so the question list keeps its scroll position.
  e.target.closest('fieldset').querySelectorAll('.option').forEach(l => l.classList.toggle('checked', l.contains(e.target)));
  $('#effects').innerHTML = effectsPanel();
  const answered = QUESTIONS.filter(q => state.answers[q.id]).length;
  $('#answered-count').textContent = `${answered} of ${QUESTIONS.length} questions answered`;
  $('#answered-bar').style.width = `${100 * answered / QUESTIONS.length}%`;
});

render();
