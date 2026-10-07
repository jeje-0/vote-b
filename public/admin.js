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

function buildTable(data){
  const table = document.getElementById('resultsTable');
  table.innerHTML = '';

  const groupParticipants = data.groupParticipants || {};
  const enrolled = data.enrolled || {};
  const totalEnrolled = GROUP_ORDER.reduce((s, g) => s + (enrolled[g] ?? 0), 0);

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

  // ---- 헤더 1행: 이사 / 간사 / 학사·학생 / 합계 ----
  const headRow1 = document.createElement('tr');
  GROUP_ORDER.forEach(g => {
    headRow1.innerHTML += `<th class="group-head" colspan="${CHOICE_ORDER.length}">${GROUP_LABEL[g]}</th>`;
  });
  headRow1.innerHTML += `<th class="group-head total-group" colspan="${CHOICE_ORDER.length}">합계</th>`;

  // ---- 헤더 2행: 찬성/반대 반복 ----
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
      CHOICE_ORDER.forEach(c => {
        const v = data.groups[g][name][c];
        totals[c] += v;
        tr.innerHTML += `<td class="cell-${CHOICE_CLASS[c]}">${v}</td>`;
      });
    });
    CHOICE_ORDER.forEach(c => {
      tr.innerHTML += `<td class="cell-${CHOICE_CLASS[c]} total-cell">${totals[c]}</td>`;
    });

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
