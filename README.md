# 개발 프로젝트 관리 대시보드 (P&SD)

Hanon Systems P&SD 부품 개발 일정 · 이슈 · BOM · To-Do 관리 대시보드.
정적 HTML + Supabase(PostgreSQL) 구성이라 빌드 과정이 없습니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 전체 (다크 테마, 4개 탭) |
| `app.js` | 로직 (Supabase 연동, 플로우 렌더링, 편집) |
| `config.js` | Supabase URL / anon 키 |
| `migration.sql` | DB 스키마 (한 번 실행) |

배포에 필요한 건 위 4개 중 `index.html` / `app.js` / `config.js` 3개뿐입니다.

## 탭

- **홈** — 차종별 일정 플로우 + 협력사별 이슈 요약. 이슈는 `(MM/DD)` 단위로 쪼개져 날짜 칩으로 필터됩니다.
- **타임라인** — 차종 행을 누르면 부품 목록, 부품을 누르면 Proto~SOP 5개 컬럼이 세로로 펼쳐집니다.
- **BOM** — 차종별 BOM 트리. 접기/펼치기, 품번·품명 검색.
- **To-Do** — 표 형태 할 일 관리.

## 데이터 구조

- `projects` — 부품 단위. 부품명/품번/협력사/Step/공급망(`delivery`)/단계별 이슈(`proto_issue`~`sop_issue`)/체크포인트(`ck_*`)
- `car_schedules` — **일정은 차종 단위**입니다. 한 차종의 Proto~SOP 날짜를 여기서 관리하고, 그 차종의 모든 부품이 공유합니다.
- `bom` — 차종별 BOM 행 (`level` 로 트리 깊이 표현)
- `todos` / `attachments` — 할 일, 첨부파일(Storage `photos` 버킷)

## 처음 세팅

1. Supabase → SQL Editor → `migration.sql` 전체 붙여넣고 Run
2. `config.js` 의 URL / anon 키 확인
3. `index.html` 을 브라우저로 열면 바로 동작

## 배포 (GitHub → Vercel)

이 PC에는 git / node 가 설치되어 있지 않으므로, 설치 없이 웹에서 처리하는 방법입니다.

1. **GitHub** — 새 repository 생성 → *uploading an existing file* 클릭
   → `index.html`, `app.js`, `config.js`, `migration.sql`, `README.md` 드래그 → Commit
   ※ `개발현황_관리.xlsx` 와 `이성호_개발현황_*.html` 은 올리지 마세요 (`.gitignore` 에 이미 제외)
2. **Vercel** — *Add New → Project → Import Git Repository* 에서 그 repo 선택
   → Framework Preset: **Other**, 설정 그대로 Deploy
3. 끝. 이후 GitHub 에서 파일을 수정하면 Vercel 이 자동 재배포합니다.

CLI 를 쓰고 싶으면 Git + Node 를 설치한 뒤:

```
git init
git add .
git commit -m "init"
git remote add origin <repo URL>
git push -u origin main
```

## 주의

`config.js` 의 anon 키는 브라우저에 노출되고, 현재 RLS 정책은 **누구나 읽기/쓰기 허용**입니다.
즉 URL 을 아는 사람은 데이터를 수정·삭제할 수 있습니다.
나중에 잠그려면 Supabase Auth 로그인을 붙이고 각 테이블 정책을 `authenticated` 로만 제한하면 됩니다.
