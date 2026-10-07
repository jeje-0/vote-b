const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'ivf2026admin';
const DATA_FILE = path.join(__dirname, 'votes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CANDIDATES = ['김길동', '이길동', '박길동', '소길동', '한길동']; // 후보 이름은 여기서만 수정하세요
const TOTAL_TARGET = 75;

// 테스트 모드: TEST_MODE=1 로 실행하면 '기기당 1표 제한'만 꺼집니다.
// 실제 투표 때는 이 환경변수를 지우거나 0으로 두세요.
const TEST_MODE = process.env.TEST_MODE === '1';

// Upstash Redis 환경변수가 설정되어 있으면 그걸 영구 저장소로 사용하고,
// 없으면 로컬 테스트를 위해 votes.json 파일을 그대로 사용합니다.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// ELECTION_ID: 투표 회차 이름. 바꾸면 저장소(표·재적 인원)가 새로 시작되고,
// 이미 투표했던 기기의 '투표 완료' 표시도 무효가 되어 같은 기기로 다시 투표할 수 있습니다.
// 예) 테스트 때는 test1, 실제 투표 때는 live 로 바꿔서 배포.
const ELECTION_ID = process.env.ELECTION_ID || 'default';
const REDIS_KEY = ELECTION_ID === 'default' ? 'votes' : 'votes:' + ELECTION_ID;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

async function redisCommand(commandArray) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commandArray),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function readVotesFile() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function appendVoteFile(vote) {
  const votes = readVotesFile();
  votes.push(vote);
  fs.writeFileSync(DATA_FILE, JSON.stringify(votes, null, 2));
}

async function readVotes() {
  if (USE_REDIS) {
    const raw = await redisCommand(['LRANGE', REDIS_KEY, '0', '-1']);
    return (raw || []).map((s) => JSON.parse(s));
  }
  return readVotesFile();
}

async function appendVote(vote) {
  if (USE_REDIS) {
    await redisCommand(['RPUSH', REDIS_KEY, JSON.stringify(vote)]);
    return;
  }
  appendVoteFile(vote);
}

// ---- 재적(현장 참석) 인원: 구분별로 관리자가 입력 ----
const ENROLLED_FILE = path.join(__dirname, 'enrolled.json');
const ENROLLED_KEY = REDIS_KEY + ':enrolled';
const ENROLLED_GROUPS = ['이사', '간사', '학생·학사'];

async function readEnrolled() {
  const base = { '이사': 0, '간사': 0, '학생·학사': 0 };
  let saved = {};
  try {
    if (USE_REDIS) {
      const raw = await redisCommand(['GET', ENROLLED_KEY]);
      if (raw) saved = JSON.parse(raw);
    } else if (fs.existsSync(ENROLLED_FILE)) {
      saved = JSON.parse(fs.readFileSync(ENROLLED_FILE, 'utf8'));
    }
  } catch (e) {}
  ENROLLED_GROUPS.forEach((g) => {
    const n = Number(saved[g]);
    if (Number.isFinite(n) && n >= 0) base[g] = Math.floor(n);
  });
  return base;
}

async function writeEnrolled(obj) {
  if (USE_REDIS) {
    await redisCommand(['SET', ENROLLED_KEY, JSON.stringify(obj)]);
  } else {
    fs.writeFileSync(ENROLLED_FILE, JSON.stringify(obj, null, 2));
  }
}

function handleEnrolled(req, res) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return sendJson(res, 401, { ok: false, error: '관리자 인증이 필요합니다.' });
  }
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      const { group, count } = JSON.parse(body);
      const n = Math.floor(Number(count));
      if (!ENROLLED_GROUPS.includes(group) || !Number.isFinite(n) || n < 0 || n > 100000) {
        return sendJson(res, 400, { ok: false, error: '입력값이 올바르지 않습니다.' });
      }
      const enrolled = await readEnrolled();
      enrolled[group] = n;
      await writeEnrolled(enrolled);
      sendJson(res, 200, { ok: true, enrolled });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: '저장에 실패했습니다: ' + e.message });
    }
  });
}

function groupOf(category) {
  if (category === '학생' || category === '학사') return '학생·학사';
  return category;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath.split('?')[0]);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function handleVote(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: '잘못된 요청입니다.' });
    }

    const CHOICES = ['찬성', '반대'];
    const { category, choices, deviceToken } = payload || {};
    const validCategory = ['학생', '학사', '이사', '간사'].includes(category);
    const validChoices =
      choices && CANDIDATES.every((name) => CHOICES.includes(choices[name]));
    const validToken =
      typeof deviceToken === 'string' && deviceToken.length >= 8 && deviceToken.length <= 100;

    if (!validCategory || !validChoices || !validToken) {
      return sendJson(res, 400, { ok: false, error: '입력값이 올바르지 않습니다.' });
    }

    try {
      // 기기당 1표: 같은 기기 토큰으로 이미 제출된 표가 있으면 거부
      const votes = await readVotes();
      if (!TEST_MODE && votes.some((v) => v.deviceToken === deviceToken)) {
        return sendJson(res, 409, { ok: false, error: '이미 이 기기에서 투표하셨습니다.' });
      }
      // 목표 인원(TOTAL_TARGET)을 채웠으면 더 이상 받지 않음 (TEST_MODE와 무관하게 항상 적용)
      if (votes.length >= TOTAL_TARGET) {
        return sendJson(res, 403, { ok: false, error: `목표 인원(${TOTAL_TARGET}명) 투표가 모두 마감되었습니다.` });
      }
      await appendVote({ category, choices, deviceToken, ts: Date.now() });
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: '저장에 실패했습니다: ' + e.message });
    }
  });
}

async function handleCount(req, res) {
  try {
    const votes = await readVotes();
    sendJson(res, 200, { count: votes.length, total: TOTAL_TARGET });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: '불러오기에 실패했습니다: ' + e.message });
  }
}

async function handleResults(req, res) {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    return sendJson(res, 401, { ok: false, error: '관리자 인증이 필요합니다.' });
  }

  try {
    const votes = await readVotes();
    const count = votes.length;

    const groups = { '학생·학사': {}, 이사: {}, 간사: {} };
    const groupParticipants = { '학생·학사': 0, 이사: 0, 간사: 0 };
    Object.keys(groups).forEach((g) => {
      CANDIDATES.forEach((name) => {
        groups[g][name] = { 찬성: 0, 반대: 0 };
      });
    });

    votes.forEach((v) => {
      const g = groupOf(v.category);
      if (!groups[g]) return;
      groupParticipants[g]++;
      CANDIDATES.forEach((name) => {
        const c = v.choices[name];
        if (c === '찬성' || c === '반대') groups[g][name][c]++;
      });
    });

    // 구분별 합계(모든 후보의 찬성/반대를 더한 값)
    const groupTotals = {};
    Object.keys(groups).forEach((g) => {
      groupTotals[g] = { 찬성: 0, 반대: 0 };
      CANDIDATES.forEach((name) => {
        groupTotals[g].찬성 += groups[g][name].찬성;
        groupTotals[g].반대 += groups[g][name].반대;
      });
    });

    sendJson(res, 200, {
      count,
      total: TOTAL_TARGET,
      candidates: CANDIDATES,
      groups,
      groupParticipants,
      groupTotals,
      enrolled: await readEnrolled(),
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: '불러오기에 실패했습니다: ' + e.message });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/vote') {
    return handleVote(req, res);
  }
  if (req.method === 'GET' && req.url === '/api/config') {
    return sendJson(res, 200, { candidates: CANDIDATES, total: TOTAL_TARGET, testMode: TEST_MODE, electionId: ELECTION_ID });
  }
  if (req.method === 'GET' && req.url === '/api/count') {
    return handleCount(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/enrolled') {
    return handleEnrolled(req, res);
  }
  if (req.method === 'GET' && req.url === '/api/results') {
    return handleResults(req, res);
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`IVF 투표 서버 실행 중: http://localhost:${PORT}`);
  if (TEST_MODE) console.log('⚠️ TEST_MODE 켜짐: 기기당 1표 제한 해제됨');
  console.log('회차(ELECTION_ID): ' + ELECTION_ID + ' / 저장 키: ' + REDIS_KEY);
  console.log(USE_REDIS ? '저장소: Upstash Redis (영구 저장)' : '저장소: votes.json 파일 (재배포 시 초기화됨 — 테스트용)');
});
