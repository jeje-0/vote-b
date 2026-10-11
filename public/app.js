let ELECTION_ID = 'default';
function getDeviceToken(){
  let token = localStorage.getItem('ivf_device_token');
  if(!token){
    token = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now() + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
    localStorage.setItem('ivf_device_token', token);
  }
  return token;
}

let TEST_MODE = false; // 서버의 TEST_MODE 값을 따라갑니다
let CANDIDATES = []; // 후보 이름은 server.js에서 불러옵니다 (수정은 server.js 한 곳만)
let choices = {};
let selectedCategory = '';

function buildCandidateArea(){
  const area = document.getElementById('candidateArea');
  area.innerHTML = '';
  CANDIDATES.forEach(name => {
    const div = document.createElement('div');
    div.className = 'candidate';
    div.innerHTML = `
      <div class="name">${name}</div>
      <div class="toggle">
        <button type="button" data-name="${name}" data-val="찬성">찬성</button>
        <button type="button" data-name="${name}" data-val="반대">반대</button>
      </div>
    `;
    area.appendChild(div);
  });
  area.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name, val = btn.dataset.val;
      choices[name] = val;
      area.querySelectorAll(`button[data-name="${name}"]`).forEach(b => {
        b.classList.remove('active-yes','active-no','active-abstain');
      });
      const cls = val === '찬성' ? 'active-yes' : (val === '반대' ? 'active-no' : 'active-abstain');
      btn.classList.add(cls);
      checkSubmitReady();
    });
  });
}

function checkSubmitReady(){
  const allChosen = CANDIDATES.every(n => choices[n]);
  document.getElementById('submitBtn').disabled = !allChosen;
}

// 구분별 재적 인원 마감 현황 (서버가 알려줌)
let closedGroups = {};
function groupOfClient(c){ return (c === '학생' || c === '학사') ? '학생·학사' : c; }
function groupLabelClient(g){ return g === '학생·학사' ? '학사/학생' : g; }

// Step 1: category selection
function refreshCategoryState(){
  const v = document.getElementById('category').value;
  const msg = document.getElementById('categoryClosedMsg');
  const closed = v && closedGroups[groupOfClient(v)];
  document.getElementById('toStep2Btn').disabled = !v || Boolean(closed);
  if(closed){
    msg.textContent = groupLabelClient(groupOfClient(v)) + ' 재적 인원(' + closed + '명) 투표가 모두 마감되었습니다.';
    msg.style.display = 'block';
  }else{
    msg.style.display = 'none';
  }
}
document.getElementById('category').addEventListener('change', refreshCategoryState);

document.getElementById('toStep2Btn').addEventListener('click', () => {
  selectedCategory = document.getElementById('category').value;
  // 이전에 마감 안내가 떴더라도 구분을 바꿔 다시 시도할 수 있게 초기화
  document.getElementById('errorMsg').style.display = 'none';
  document.getElementById('submitBtn').textContent = '투표 제출하기';
  checkSubmitReady();
  document.getElementById('step1').style.display = 'none';
  document.getElementById('step2').style.display = 'block';
  document.getElementById('dot1').classList.remove('active');
  document.getElementById('dot2').classList.add('active');
});

document.getElementById('backBtn').addEventListener('click', () => {
  document.getElementById('step2').style.display = 'none';
  document.getElementById('step1').style.display = 'block';
  document.getElementById('dot2').classList.remove('active');
  document.getElementById('dot1').classList.add('active');
});

function showDone(){
  document.getElementById('formArea').style.display = 'none';
  document.getElementById('doneArea').style.display = 'block';
}

document.getElementById('submitBtn').addEventListener('click', async () => {
  const btn = document.getElementById('submitBtn');
  const errorMsg = document.getElementById('errorMsg');
  errorMsg.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '제출 중...';
  try{
    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: selectedCategory, choices, deviceToken: getDeviceToken() })
    });
    const data = await res.json();

    if(res.status === 409){
      localStorage.setItem('ivf_vote_submitted', ELECTION_ID);
      showDone();
      loadCount();
      return;
    }
    if(res.status === 403){
      errorMsg.textContent = data.error || '목표 인원 투표가 모두 마감되었습니다.';
      errorMsg.style.display = 'block';
      btn.disabled = true;
      btn.textContent = '투표 마감';
      if(data.groupClosed) loadCount();
      return;
    }
    if(!data.ok) throw new Error(data.error || '제출 실패');

    localStorage.setItem('ivf_vote_submitted', ELECTION_ID);
    showDone();
    loadCount();
  }catch(e){
    errorMsg.textContent = '제출에 실패했습니다: ' + e.message;
    errorMsg.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '투표 제출하기';
  }
});

async function loadCount(){
  try{
    const res = await fetch('/api/count');
    const data = await res.json();
    if(!res.ok){
      console.error('참여 인원 조회 실패:', data.error);
      return;
    }
    closedGroups = data.closed || {};
    refreshCategoryState();
    document.getElementById('voteCount').textContent = data.count;
    document.getElementById('totalTarget').textContent = data.total;
    const pct = Math.min(100, Math.round((data.count / data.total) * 100));
    document.getElementById('barFill').style.width = pct + '%';

    if(data.count >= data.total && localStorage.getItem('ivf_vote_submitted') !== ELECTION_ID){
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = '투표 마감';
      const errorMsg = document.getElementById('errorMsg');
      errorMsg.textContent = '목표 인원 투표가 모두 마감되었습니다.';
      errorMsg.style.display = 'block';
    }
  }catch(e){}
}

async function init(){
  try{
    const cfg = await (await fetch('/api/config')).json();
    CANDIDATES = cfg.candidates;
    TEST_MODE = Boolean(cfg.testMode);
    ELECTION_ID = cfg.electionId || 'default';
  }catch(e){
    document.getElementById('errorMsg').textContent = '후보 정보를 불러오지 못했습니다. 새로고침해 주세요.';
    document.getElementById('errorMsg').style.display = 'block';
  }
  buildCandidateArea();
  if(!TEST_MODE && localStorage.getItem('ivf_vote_submitted') === ELECTION_ID){
    showDone();
  }
  loadCount();
  setInterval(loadCount, 5000);
}
init();
