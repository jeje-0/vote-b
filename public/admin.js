let adminKey = '';

const GROUP_ORDER = ['이사', '간사', '학생·학사'];
const GROUP_LABEL = { '이사': '이사', '간사': '간사', '학생·학사': '학사/학생' };
const CHOICE_ORDER = ['찬성', '반대'];
const CHOICE_CLASS = { '찬성': 'yes', '반대': 'no' };

async function tryLoad(){
  try{
    const res = await fetch('/api/results', {
      headers: { 'x-admin-key': adminKey }
    });
    const data = await res.json();
    if(res.status === 401){
      return { ok: false, error: '비밀번호가 올바르지 않습니다.' };
    }
    if(!res.ok){
      return { ok: false, error: data.error || '집계를 불러오지 못했습니다.' };
    }
    return { ok: true, data };
  }catch(e){
    return { ok: false, error: '불러오기에 실패했습니다.' };
  }
}

// ===== 통과 조건 (직접 바꾸려면 아래 세 줄만 고치면 됩니다) =====
// REQUIRED_GROUPS : 해당 구분 재적 인원의 과반 찬성이 필요한 구분 ('이사', '간사', '학생·학사' 중에서 고름, 없으면 [])
// REQUIRE_TOTAL   : true 이면 전체(합계) 재적 인원의 과반 찬성이 필요
// WIN_LABEL       : 조건을 충족했을 때 결과 칸에 표시할 말
const REQUIRED_GROUPS = [];
const REQUIRE_TOTAL = true;
const WIN_LABEL = '통과';

function majorityNeed(enrolled){
  return enrolled > 0 ? Math.floor(enrolled / 2) + 1 : 0;
}

function conditionText(){
  const parts = REQUIRED_GROUPS.map(g => GROUP_LABEL[g] + ' 과반');
  if(REQUIRE_TOTAL) parts.push('전체 과반');
  return parts.join(' + ');
}

function buildTable(data){
  const table = document.getElementById('resultsTable');
  table.innerHTML = '';
  const legend = document.getElementById('legendText');
  if(legend) legend.textContent = '※ ' + WIN_LABEL + ' 기준: ' + conditionText() + ' (재적 인원의 절반을 넘는 찬성) 조건을 모두 충족해야 ' + WIN_LABEL + '입니다. 초록 ✓는 해당 기준의 과반 달성 표시입니다.';

  const groupParticipants = data.groupParticipants || {};
  const enrolled = data.enrolled || {};
  const totalEnrolled = GROUP_ORDER.reduce((s, g) => s + (enrolled[g] ?? 0), 0);
  const totalNeed = majorityNeed(totalEnrolled);

  // ---- 헤더 0행: 구분별 참여 N표 / 재적 M명 (재적은 현장에서 입력) ----
  const summaryRow = document.createElement('tr');
  summaryRow.innerHTML = `<th class="cand-head" rowspan="3">후보명</th>`;
  GROUP_ORDER.forEach(g => {
    const p = groupParticipants[g] ?? 0;
    const e = enrolled[g] ?? 0;
    const over = e > 0 && p > e ? ' over' : '';
    summaryRow.innerHTML += `<th class="summary-head${over}" colspan="${CHOICE_ORDER.length}">
      참여 <b>${p}</b>표 / 재적
      <input type="number" class="enrolled-input" min="0" inputmode="numeric" data-group="${g}" value="${e}"><span class="enrolled-text"><b>${e}</b></span>명
    </th>`;
  });
  summaryRow.innerHTML += `<th class="summary-head total-group" colspan="${CHOICE_ORDER.length}">참여 <b>${data.count}</b>표 / 재적 <b>${totalEnrolled}</b>명</th>`;
  summaryRow.innerHTML += `<th class="result-head" rowspan="3">결과<small>${conditionText()}</small></th>`;

  // ---- 헤더 1행: 구분명 + 과반 기준 ----
  const headRow1 = document.createElement('tr');
  GROUP_ORDER.forEach(g => {
    // 과반 기준은 REQUIRED_GROUPS 에 들어 있는 구분에만 표시
    let note = '';
    if(REQUIRED_GROUPS.includes(g)){
      const need = majorityNeed(enrolled[g] ?? 0);
      note = `<small>${need ? '과반 ' + need + '표 필요' : '재적 입력 필요'}</small>`;
    }
    headRow1.innerHTML += `<th class="group-head" colspan="${CHOICE_ORDER.length}">${GROUP_LABEL[g]}${note}</th>`;
  });
  headRow1.innerHTML += `<th class="group-head total-group" colspan="${CHOICE_ORDER.length}">합계<small>${totalNeed ? '과반 ' + totalNeed + '표' : '재적 입력 필요'}</small></th>`;

  // ---- 헤더 2행: 찬성/반대 ----
  const headRow2 = document.createElement('tr');
  GROUP_ORDER.forEach(() => {
    CHOICE_ORDER.forEach(c => {
      headRow2.innerHTML += `<th class="choice-head choice-${CHOICE_CLASS[c]}">${c}</th>`;
    });
  });
  CHOICE_ORDER.forEach(c => {
    headRow2.innerHTML += `<th class="choice-head choice-${CHOICE_CLASS[c]} total-group">${c}</th>`;
  });

  const thead = document.createElement('thead');
  thead.appendChild(summaryRow);
  thead.appendChild(headRow1);
  thead.appendChild(headRow2);
  table.appendChild(thead);

  // ---- 본문: 후보별 행 (구분별 합계 행은 없음) ----
  const tbody = document.createElement('tbody');
  data.candidates.forEach(name => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="cand-name">${name}</td>`;

    const totals = { 찬성: 0, 반대: 0 };
    GROUP_ORDER.forEach(g => {
      const need = majorityNeed(enrolled[g] ?? 0);
      CHOICE_ORDER.forEach(c => {
        const v = data.groups[g][name][c];
        totals[c] += v;
        const pass = REQUIRED_GROUPS.includes(g) && c === '찬성' && need > 0 && v >= need ? ' pass' : '';
        tr.innerHTML += `<td class="cell-${CHOICE_CLASS[c]}${pass}">${v}</td>`;
      });
    });
    CHOICE_ORDER.forEach(c => {
      const pass = c === '찬성' && totalNeed > 0 && totals[c] >= totalNeed ? ' pass' : '';
      tr.innerHTML += `<td class="cell-${CHOICE_CLASS[c]} total-cell${pass}">${totals[c]}</td>`;
    });

    // 결과: REQUIRED_GROUPS 각 구분의 과반 찬성 AND (REQUIRE_TOTAL 이면) 전체 과반 찬성 -> 통과
    const conds = REQUIRED_GROUPS.map(g => ({
      label: GROUP_LABEL[g],
      need: majorityNeed(enrolled[g] ?? 0),
      yes: data.groups[g][name].찬성
    }));
    if(REQUIRE_TOTAL) conds.push({ label: '전체', need: totalNeed, yes: totals.찬성 });

    let result;
    if(conds.some(x => !x.need)){
      result = `<span class="badge wait">재적 입력 필요</span>`;
    }else if(conds.every(x => x.yes >= x.need)){
      result = `<span class="badge win">${WIN_LABEL}</span>`;
    }else{
      const lacks = conds.filter(x => x.yes < x.need).map(x => x.label + ' ' + (x.need - x.yes) + '표 부족');
      result = `<span class="badge lose">미달</span><small class="need-more">${lacks.join(' · ')}</small>`;
    }
    tr.innerHTML += `<td class="result-cell">${result}</td>`;

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

const saveTimers = {};
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if(!el.classList || !el.classList.contains('enrolled-input')) return;
  const group = el.dataset.group;
  clearTimeout(saveTimers[group]);
  saveTimers[group] = setTimeout(async () => {
    const count = Math.max(0, Math.floor(Number(el.value) || 0));
    try{
      await fetch('/api/enrolled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ group, count })
      });
    }catch(e){}
  }, 300);
});

function renderResults(data){
  // 재적 인원을 입력하는 중에는 표를 다시 그리지 않음 (입력이 끊기지 않도록)
  const ae = document.activeElement;
  if(ae && ae.classList && ae.classList.contains('enrolled-input')) return;

  document.getElementById('voteCount').textContent = data.count;
  document.getElementById('totalTarget').textContent = data.total;
  const pct = Math.min(100, Math.round((data.count / data.total) * 100));
  document.getElementById('barFill').style.width = pct + '%';

  buildTable(data);
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const errBox = document.getElementById('loginErr');
  errBox.style.display = 'none';
  adminKey = document.getElementById('adminKeyInput').value;

  const result = await tryLoad();
  if(!result.ok){
    errBox.textContent = result.error;
    errBox.style.display = 'block';
    return;
  }

  document.getElementById('loginView').style.display = 'none';
  document.getElementById('resultsView').style.display = 'block';
  renderResults(result.data);

  setInterval(async () => {
    const r = await tryLoad();
    if(r.ok) renderResults(r.data);
  }, 5000);
});

// 발표 화면: 입력칸을 숨기고 큰 글씨로 전체화면 표시
document.getElementById('presentBtn').addEventListener('click', () => {
  const on = document.body.classList.toggle('presenting');
  if(on && document.documentElement.requestFullscreen){
    document.documentElement.requestFullscreen().catch(() => {});
  }else if(!on && document.fullscreenElement && document.exitFullscreen){
    document.exitFullscreen();
  }
  document.getElementById('presentBtn').textContent = on ? '발표 화면 끄기' : '발표 화면';
});
document.addEventListener('fullscreenchange', () => {
  if(!document.fullscreenElement && document.body.classList.contains('presenting')){
    document.body.classList.remove('presenting');
    document.getElementById('presentBtn').textContent = '발표 화면';
  }
});
