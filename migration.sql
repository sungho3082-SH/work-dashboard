-- ════════════════════════════════════════════════════════
-- 개발현황 대시보드 v4 마이그레이션
-- Supabase → SQL Editor 에 전체 복사해서 Run 한 번
-- (기존 데이터는 지우지 않습니다. 컬럼/테이블만 추가)
-- ════════════════════════════════════════════════════════

-- ── 1) projects: Step / 이슈그룹 / 체크포인트 4종 ──
alter table projects add column if not exists step          text;
alter table projects add column if not exists issue_group   text;
alter table projects add column if not exists ck_all_tool   date;
alter table projects add column if not exists ck_full_tool  date;
alter table projects add column if not exists ck_audit      date;
alter table projects add column if not exists ck_full_capa  date;
-- 체크포인트가 '미실시'처럼 날짜가 아닌 상태일 때 표기용
alter table projects add column if not exists ck_note       text;

-- ── 2) car_schedules: 일정은 차종 단위로 관리 ──
-- (엑셀 '일정' 시트가 차종 단위라 그 구조를 그대로 따릅니다.
--  projects의 기존 proto_start~sop_start 컬럼은 지우지 않고 남겨둡니다.)
create table if not exists car_schedules (
  car_model   text primary key,
  proto_start date,
  p1_start    date,
  p2_start    date,
  m_start     date,
  sop_start   date,
  proto_skip  boolean default false,
  p1_skip     boolean default false,
  p2_skip     boolean default false,
  m_skip      boolean default false,
  sop_skip    boolean default false,
  volume      text,
  sort_order  int,
  created_at  timestamptz default now()
);

-- 기존 projects 날짜를 차종 단위로 승격 (차종별 최초 non-null 값)
insert into car_schedules (car_model, proto_start, p1_start, p2_start, m_start, sop_start, volume, sort_order)
select
  car_model,
  min(proto_start), min(p1_start), min(p2_start), min(m_start), min(sop_start),
  max(volume),
  min(sort_order)
from projects
where car_model is not null and car_model <> ''
group by car_model
on conflict (car_model) do nothing;

-- 날짜가 아예 없는 단계는 생략 처리
update car_schedules set proto_skip = true where proto_start is null;
update car_schedules set p1_skip    = true where p1_start    is null;
update car_schedules set p2_skip    = true where p2_start    is null;
update car_schedules set m_skip     = true where m_start     is null;
update car_schedules set sop_skip   = true where sop_start   is null;

-- ── 3) bom: 차종별 BOM 트리 ──
create table if not exists bom (
  id         bigserial primary key,
  car_model  text not null,
  level      int  not null default 1,
  variant    text,          -- HVAC / COOLING 등 구분
  part_no    text,
  part_name  text,
  nc         text,          -- New / Carry-over
  mb         text,          -- Make / Buy
  plant      text,
  supplier   text,
  remark     text,
  sort_order int,
  created_at timestamptz default now()
);
create index if not exists bom_car_sort_idx on bom (car_model, sort_order);

-- ── 4) attachments: 어느 단계 사진인지 (이미 있으면 통과) ──
alter table attachments add column if not exists stage text;

-- ── 5) RLS: 나머지 테이블과 동일하게 공개 ──
alter table car_schedules enable row level security;
alter table bom           enable row level security;

drop policy if exists "car_schedules public" on car_schedules;
create policy "car_schedules public" on car_schedules
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "bom public" on bom;
create policy "bom public" on bom
  for all to anon, authenticated using (true) with check (true);

-- ── 6) 확인 ──
select 'car_schedules' as t, count(*) from car_schedules
union all select 'bom', count(*) from bom
union all select 'projects', count(*) from projects;

-- ════════════════════════════════════════════════════════
-- 추가 (2026-10-01) : Open Issue List 의 Date 컬럼
-- 이미 실행했어도 다시 돌려도 안전합니다.
-- ════════════════════════════════════════════════════════
alter table todos add column if not exists open_date date;

-- 기존 이슈는 등록된 날짜로 채워둡니다 (비어 있는 것만)
update todos set open_date = created_at::date where open_date is null;

select 'todos.open_date 준비됨' as result, count(*) as 채워진행 from todos where open_date is not null;

-- ════════════════════════════════════════════════════════
-- 추가 (2026-10-19) : HOME 탭 — 부품별 단계 체크 항목 (QRM Handbook)
-- 이미 실행했어도 다시 돌려도 안전합니다.
-- ════════════════════════════════════════════════════════

-- 부품 담당 PM (HOME 표의 PM 칸)
alter table projects add column if not exists pm text;

-- 부품 × Handbook 활동 × 단계 마다 한 줄 (손댄 항목만 생깁니다)
create table if not exists project_tasks (
  id          bigserial primary key,
  project_id  bigint not null references projects(id) on delete cascade,
  act_no      int    not null,          -- Handbook 4.0 활동 번호 (qrm_data.js)
  stage       text   not null,          -- proto / p1 / p2 / m / sop
  applicable  boolean,                  -- null = 기본값(추천 여부) 따름, false = 이 부품에서 제외
  status      text   default 'plan',    -- plan / doing / done
  plan_date   date,
  done_date   date,
  result      text,
  updated_at  timestamptz default now(),
  created_at  timestamptz default now(),
  unique (project_id, act_no, stage)
);
create index if not exists project_tasks_proj_idx on project_tasks (project_id);

-- 항목별 첨부
alter table attachments add column if not exists ptask_id bigint references project_tasks(id) on delete cascade;

alter table project_tasks enable row level security;
drop policy if exists "project_tasks public" on project_tasks;
create policy "project_tasks public" on project_tasks
  for all to anon, authenticated using (true) with check (true);

select 'project_tasks 준비됨' as result, count(*) from project_tasks;

-- ════════════════════════════════════════════════════════
-- 추가 (2026-10-19 · 2) : 고객사(ROA) 체크는 차종 단위로 저장
-- 이미 실행했어도 다시 돌려도 안전합니다.
-- ════════════════════════════════════════════════════════
alter table project_tasks alter column project_id drop not null;
alter table project_tasks add column if not exists car_model text;

-- 차종 단위 항목은 (차종, 항목, 단계) 마다 한 줄
create unique index if not exists project_tasks_car_uq
  on project_tasks (car_model, act_no, stage) where project_id is null;

select 'project_tasks.car_model 준비됨' as result;
