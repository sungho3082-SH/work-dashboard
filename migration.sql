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
