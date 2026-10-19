# 개발 프로젝트 관리 대시보드 (P&SD)

Hanon Systems P&SD 부품 개발 일정 · 이슈 · BOM · To-Do 관리 대시보드.
정적 HTML + Supabase(PostgreSQL) 구성이라 빌드 과정이 없습니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 전체 (다크 테마, 4개 탭) |
| `app.js` | 로직 (Supabase 연동, 플로우 렌더링, 편집) |
| `config.js` | Supabase URL / anon 키 |
| `qrm_data.js` | QRM Handbook 활동 49개 (영/한) — 오른쪽 위 Handbook 자료실 — 자동 생성 |
| `track_data.js` | 협력사 PQA 85개 / 고객사 ROA 258개 체크 항목 (영/한, Handbook 연결) — 자동 생성 |
| `migration.sql` | DB 스키마 (한 번 실행) |

배포에 필요한 건 `index.html` / `app.js` / `config.js` / `qrm_data.js` 4개입니다.

## 탭

- **HOME** — 차종 ▸ 부품 엑셀형 표. 단계 일정(지난 일정 취소선 · 30일/90일 이내 색 · 다음 단계 테두리), 부품별 단계 체크 진행률, 월별 현황(단계 칩 · ★체크포인트).
  부품 행을 누르면 상세 창: Proto~SOP 단계 도식 → 단계별 체크 항목 → 항목의 목적·방법(Handbook 원문, EN/한국어 전환)·결과·첨부.
  주소 끝에 `#p=부품id&s=p2&a=16` 을 붙이면 해당 부품/단계/항목이 바로 열립니다.
- **MEMO** — (예전 홈) 차종별 일정 플로우 + 협력사별 이슈 요약. 이슈는 `(MM/DD)` 단위로 쪼개져 날짜 칩으로 필터됩니다.
- **타임라인** — 차종 행을 누르면 부품 목록, 부품을 누르면 Proto~SOP 5개 컬럼이 세로로 펼쳐집니다.
- **BOM** — 차종별 BOM 트리. 접기/펼치기, 품번·품명 검색.
- **To-Do** — 표 형태 할 일 관리.

## 데이터 구조

- `projects` — 부품 단위. 부품명/품번/협력사/Step/공급망(`delivery`)/단계별 이슈(`proto_issue`~`sop_issue`)/체크포인트(`ck_*`)
- `car_schedules` — **일정은 차종 단위**입니다. 한 차종의 Proto~SOP 날짜를 여기서 관리하고, 그 차종의 모든 부품이 공유합니다.
- `bom` — 차종별 BOM 행 (`level` 로 트리 깊이 표현)
- `todos` / `attachments` — 할 일, 첨부파일(Storage `photos` 버킷). 체크 항목 첨부는 `attachments.ptask_id`
- `project_tasks` — 부품 × Handbook 활동 × 단계 한 줄. 상태(계획/진행/완료), 계획일·완료일, 결과, 적용 여부(`null` 이면 추천 기본값)

## 체크 항목 (2트랙) + Handbook

- **부품 행 → 협력사(PQA)**: SRM PQA 시나리오 마스터 리스트 기준. 부품마다 시나리오(비전자/PCBA/전자부품/멀티사이트/캐리오버)와
  복잡도(High/Medium/Low/P0)를 고르면 필수(M) 항목이 자동으로 켜짐. 단계: Proto = SoCo·S-VRF · P1 = DESV · P2 = PROV · M = SISV · SOP = PQAG·양산 중
- **차종 행 → 고객사(ROA)**: 개발절차의 마일스톤 체크리스트(CAAV~SSSR, 부문별 활동·산출물·판정 기준). 차종 단위로 한 번만 관리
- 항목마다 짧은 설명 + 관련 **Handbook** 활동 링크. Handbook(QRM 4.0 rel 2.3, 49개)은 오른쪽 위 버튼으로 언제든 열람
- 부품별 PQA 설정은 `project_tasks` 의 `act_no=0, stage='cfg'` 줄에 JSON 으로 보관
- 원문은 `참고자료/` 폴더의 엑셀·PDF에서 추출합니다 (`.gitignore` 로 제외)

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

## 항목 설정 (오른쪽 위 ⚙ 항목 설정)

- 협력사 / 고객사 트랙마다 **Proto~SOP 단계별로 어떤 항목을 넣을지 체크**로 정리 (PQA·ROA 항목 + Handbook 49개 활동)
- 표시: 회색 테두리 = 원래 단계, 보라 배경 = Handbook 기준 수행 시점, 노랑 = 기본값에서 바꾼 칸
- 바꾼 칸만 `checklist_tpl` 에 저장되고 모든 부품/차종에 같이 적용. "되돌리기"로 기본값 복귀

## 나중에 할 일

- [ ] **CCL 공정별 점검 항목 연결** — Drive "1. Supplier Quality / 2. CCL / CCL Study" (사출, 금형 관리, PCBA 전/후공정, 현장점검 KUM).
      파일이 7MB 라 그대로는 못 받음 → 시트별로 "복사 대상 → 새 스프레드시트" 로 떼어서 받은 뒤 PQA 의 공정감사·FDPR 항목 등에 연결
- [ ] **협력사 PQA 실무 취합 엑셀 반영** — 5~6개 업체 PQA 자료를 개발 섹션별로 정리한 파일 (위치 확인 필요)
- [ ] **로그인** — 이메일 인증(회사 도메인 제한) + 허용 이메일 목록, RLS 를 authenticated 로 전환
