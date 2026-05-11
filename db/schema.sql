create table if not exists station_line_order (
  operator text not null,
  line_no text not null,
  station_code text not null,
  station_name text not null,
  sequence_no integer not null check (sequence_no > 0),
  primary key (operator, line_no, station_code),
  unique (operator, line_no, station_name),
  unique (operator, line_no, sequence_no)
);

create table if not exists train_layout (
  operator text not null,
  line_no text not null,
  branch_code text not null default 'MAIN',
  direction_code text not null,
  car_count integer not null check (car_count > 0),
  doors_per_car integer not null check (doors_per_car > 0),
  source text not null,
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  valid_from date not null,
  valid_to date,
  primary key (operator, line_no, branch_code, direction_code, valid_from)
);

create table if not exists ridership_profile (
  line_no text not null,
  station_name text not null,
  day_type text not null check (day_type in ('WEEKDAY', 'WEEKEND')),
  time_slot text not null check (time_slot ~ '^([01][0-9]|2[0-3]):(00|30)$'),
  boardings integer not null check (boardings >= 0),
  alightings integer not null check (alightings >= 0),
  source text not null,
  observed_month date not null,
  ingested_at timestamptz not null default now(),
  primary key (line_no, station_name, day_type, time_slot, observed_month)
);

create table if not exists congestion_profile (
  line_no text not null,
  direction_code text not null,
  day_type text not null check (day_type in ('WEEKDAY', 'WEEKEND')),
  time_slot text not null check (time_slot ~ '^([01][0-9]|2[0-3]):(00|30)$'),
  congestion_pct numeric(5, 2) not null check (congestion_pct >= 0),
  source text not null,
  observed_on date,
  ingested_at timestamptz not null default now(),
  primary key (line_no, direction_code, day_type, time_slot)
);

create table if not exists transfer_demand_profile (
  line_no text not null,
  station_name text not null,
  day_type text not null check (day_type in ('WEEKDAY', 'WEEKEND')),
  transfer_passengers integer not null check (transfer_passengers >= 0),
  source text not null,
  observed_on date not null,
  ingested_at timestamptz not null default now(),
  primary key (line_no, station_name, day_type, observed_on)
);

create table if not exists transfer_door (
  line_no text not null,
  station_name text not null,
  direction_code text not null,
  car_no integer not null check (car_no > 0),
  door_no integer not null check (door_no > 0),
  weight numeric(4, 3) not null check (weight >= 0 and weight <= 1),
  description text not null,
  source text not null,
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  primary key (line_no, station_name, direction_code, car_no, door_no)
);

create table if not exists exit_or_facility_door (
  line_no text not null,
  station_name text not null,
  direction_code text not null,
  car_no integer not null check (car_no > 0),
  door_no integer not null check (door_no > 0),
  weight numeric(4, 3) not null check (weight >= 0 and weight <= 1),
  description text not null,
  source text not null,
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  primary key (line_no, station_name, direction_code, car_no, door_no)
);

create table if not exists recommendation_cache (
  cache_key text primary key,
  origin text not null,
  destination text not null,
  line_no text not null,
  direction_code text not null,
  day_type text not null,
  time_slot text not null,
  payload jsonb not null,
  generated_at timestamptz not null default now()
);

create table if not exists ingestion_run (
  id bigserial primary key,
  source_name text not null,
  source_url text,
  status text not null check (status in ('STARTED', 'SUCCESS', 'FAILED')),
  row_count integer not null default 0,
  message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists ridership_profile_lookup_idx
  on ridership_profile (line_no, day_type, time_slot, observed_month desc);

create index if not exists transfer_demand_profile_lookup_idx
  on transfer_demand_profile (line_no, day_type, observed_on desc);

create index if not exists transfer_door_lookup_idx
  on transfer_door (line_no, station_name, direction_code);

create index if not exists facility_door_lookup_idx
  on exit_or_facility_door (line_no, station_name, direction_code);

create index if not exists recommendation_cache_generated_at_idx
  on recommendation_cache (generated_at desc);

alter table ridership_profile
  drop constraint if exists ridership_profile_time_slot_check;

alter table ridership_profile
  add constraint ridership_profile_time_slot_check
  check (time_slot ~ '^([01][0-9]|2[0-3]):(00|30)$');

alter table congestion_profile
  drop constraint if exists congestion_profile_time_slot_check;

alter table congestion_profile
  add constraint congestion_profile_time_slot_check
  check (time_slot ~ '^([01][0-9]|2[0-3]):(00|30)$');

alter table train_layout
  drop constraint if exists train_layout_direction_code_check;

alter table congestion_profile
  drop constraint if exists congestion_profile_direction_code_check;

alter table transfer_door
  drop constraint if exists transfer_door_direction_code_check;

alter table exit_or_facility_door
  drop constraint if exists exit_or_facility_door_direction_code_check;
