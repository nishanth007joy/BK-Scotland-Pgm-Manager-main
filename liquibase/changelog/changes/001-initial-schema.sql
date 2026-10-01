--liquibase formatted sql

--changeset bk-scotland:001-sequences
CREATE SEQUENCE event_id_seq START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE SEQUENCE contestant_id_seq START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE SEQUENCE group_contestant_id_seq START WITH 100 INCREMENT BY 1 NO CYCLE;
--rollback DROP SEQUENCE IF EXISTS group_contestant_id_seq; DROP SEQUENCE IF EXISTS contestant_id_seq; DROP SEQUENCE IF EXISTS event_id_seq;

--changeset bk-scotland:001-participants
CREATE TABLE participants (
    id VARCHAR(50) NOT NULL,
    participant_type VARCHAR(10) NOT NULL,
    CONSTRAINT pk_participants PRIMARY KEY (id),
    CONSTRAINT ck_participant_type CHECK (participant_type IN ('individual', 'group'))
);
--rollback DROP TABLE IF EXISTS participants;

--changeset bk-scotland:001-users
CREATE TABLE users (
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'data-entry',
    CONSTRAINT pk_users PRIMARY KEY (email),
    CONSTRAINT ck_users_role CHECK (role IN ('admin', 'data-entry', 'resultboard'))
);
--rollback DROP TABLE IF EXISTS users;

--changeset bk-scotland:001-missions
CREATE TABLE missions (
    mission_name VARCHAR(50) NOT NULL,
    region VARCHAR(50) NOT NULL,
    CONSTRAINT pk_missions PRIMARY KEY (mission_name)
);
--rollback DROP TABLE IF EXISTS missions;

--changeset bk-scotland:001-age-categories
CREATE TABLE age_categories (
    agid SERIAL NOT NULL,
    age_range VARCHAR(50) NOT NULL,
    CONSTRAINT pk_age_categories PRIMARY KEY (agid),
    CONSTRAINT uq_age_categories_range UNIQUE (age_range)
);
--rollback DROP TABLE IF EXISTS age_categories;

--changeset bk-scotland:001-event-points
CREATE TABLE event_points (
    individual_group CHAR(10) NOT NULL,
    on_stage_off_stage CHAR(10) NOT NULL,
    first_place INT NOT NULL,
    second_place INT NOT NULL,
    third_place INT NOT NULL,
    walkover INT NOT NULL,
    CONSTRAINT pk_event_points PRIMARY KEY (individual_group, on_stage_off_stage),
    CONSTRAINT ck_event_points_nonneg CHECK (
        first_place >= 0 AND second_place >= 0 AND third_place >= 0 AND walkover >= 0
    )
);
--rollback DROP TABLE IF EXISTS event_points;

--changeset bk-scotland:001-events
CREATE TABLE events (
    event_id VARCHAR(50) NOT NULL DEFAULT ('E' || nextval('event_id_seq')),
    event_name VARCHAR(50) NOT NULL,
    event_age_group VARCHAR(50) NOT NULL,
    individual_group CHAR(10) NOT NULL,
    on_stage_off_stage CHAR(10) NOT NULL,
    comments VARCHAR(50),
    CONSTRAINT pk_events PRIMARY KEY (event_id)
);
CREATE UNIQUE INDEX uq_events_identity ON events (
    LOWER(TRIM(event_name)),
    LOWER(TRIM(event_age_group)),
    LOWER(TRIM(individual_group)),
    LOWER(TRIM(on_stage_off_stage))
);
--rollback DROP INDEX IF EXISTS uq_events_identity; DROP TABLE IF EXISTS events;

--changeset bk-scotland:001-contestants
CREATE TABLE contestants (
    id VARCHAR(50) NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    age_group VARCHAR(50) NOT NULL,
    mission VARCHAR(50) NOT NULL,
    region VARCHAR(50) NOT NULL,
    on_stage_chest_no CHAR(10),
    off_stage_chest_no CHAR(10),
    comments VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT pk_contestants PRIMARY KEY (id),
    CONSTRAINT fk_contestants_participant FOREIGN KEY (id) REFERENCES participants(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_contestants_identity ON contestants (
    LOWER(TRIM(first_name)),
    LOWER(TRIM(last_name)),
    LOWER(TRIM(mission)),
    LOWER(TRIM(age_group))
);
CREATE UNIQUE INDEX uq_contestants_on_stage_chest ON contestants (TRIM(on_stage_chest_no))
    WHERE TRIM(on_stage_chest_no) IS NOT NULL AND TRIM(on_stage_chest_no) <> '';
CREATE UNIQUE INDEX uq_contestants_off_stage_chest ON contestants (TRIM(off_stage_chest_no))
    WHERE TRIM(off_stage_chest_no) IS NOT NULL AND TRIM(off_stage_chest_no) <> '';
--rollback DROP INDEX IF EXISTS uq_contestants_off_stage_chest; DROP INDEX IF EXISTS uq_contestants_on_stage_chest; DROP INDEX IF EXISTS uq_contestants_identity; DROP TABLE IF EXISTS contestants;

--changeset bk-scotland:001-group-contestants
CREATE TABLE group_contestants (
    id VARCHAR(50) NOT NULL,
    group_name VARCHAR(50) NOT NULL,
    event_id VARCHAR(50) REFERENCES events(event_id),
    event_name VARCHAR(50),
    age_group VARCHAR(50) NOT NULL,
    mission VARCHAR(50) NOT NULL,
    region VARCHAR(50) NOT NULL,
    chest_no CHAR(10),
    group_leader VARCHAR(50) NOT NULL,
    group_leader_id VARCHAR(50) NOT NULL REFERENCES contestants(id),
    participant_1 VARCHAR(50), participant_1_id VARCHAR(50) REFERENCES contestants(id),
    participant_2 VARCHAR(50), participant_2_id VARCHAR(50) REFERENCES contestants(id),
    participant_3 VARCHAR(50), participant_3_id VARCHAR(50) REFERENCES contestants(id),
    participant_4 VARCHAR(50), participant_4_id VARCHAR(50) REFERENCES contestants(id),
    participant_5 VARCHAR(50), participant_5_id VARCHAR(50) REFERENCES contestants(id),
    participant_6 VARCHAR(50), participant_6_id VARCHAR(50) REFERENCES contestants(id),
    participant_7 VARCHAR(50), participant_7_id VARCHAR(50) REFERENCES contestants(id),
    participant_8 VARCHAR(50), participant_8_id VARCHAR(50) REFERENCES contestants(id),
    participant_9 VARCHAR(50), participant_9_id VARCHAR(50) REFERENCES contestants(id),
    comments VARCHAR(50),
    CONSTRAINT pk_group_contestants PRIMARY KEY (id),
    CONSTRAINT fk_group_contestants_participant FOREIGN KEY (id) REFERENCES participants(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_group_contestants_leader ON group_contestants (
    LOWER(TRIM(event_id)),
    LOWER(TRIM(group_leader_id)),
    LOWER(TRIM(age_group)),
    LOWER(TRIM(mission))
);
--rollback DROP INDEX IF EXISTS uq_group_contestants_leader; DROP TABLE IF EXISTS group_contestants;

--changeset bk-scotland:001-event-registrations
CREATE TABLE event_registrations (
    event_id VARCHAR(50) NOT NULL REFERENCES events(event_id),
    event_name VARCHAR(50) NOT NULL,
    event_age_group VARCHAR(50) NOT NULL,
    individual_group CHAR(10) NOT NULL,
    on_stage_off_stage CHAR(10) NOT NULL,
    contestant_id VARCHAR(50) NOT NULL REFERENCES participants(id),
    contestant_first_name VARCHAR(50) NOT NULL,
    contestant_last_name VARCHAR(50) NOT NULL,
    contestant_mission VARCHAR(50) NOT NULL,
    chest_no CHAR(10),
    comments VARCHAR(50),
    CONSTRAINT pk_event_registrations PRIMARY KEY (event_id, contestant_id)
);
--rollback DROP TABLE IF EXISTS event_registrations;

--changeset bk-scotland:001-prepub-results
CREATE TABLE prepub_results (
    event_id VARCHAR(50) NOT NULL REFERENCES events(event_id),
    event_name VARCHAR(50) NOT NULL,
    event_age_group VARCHAR(50) NOT NULL,
    individual_group CHAR(10) NOT NULL,
    on_stage_off_stage CHAR(10) NOT NULL,
    contestant_id VARCHAR(50) NOT NULL REFERENCES participants(id),
    contestant_first_name VARCHAR(50) NOT NULL,
    contestant_last_name VARCHAR(50) NOT NULL,
    contestant_mission VARCHAR(50) NOT NULL,
    chest_no CHAR(10),
    event_attendance VARCHAR(10) NOT NULL,
    score NUMERIC(12,2),
    checked_approved VARCHAR(12) NOT NULL DEFAULT 'not approved',
    checked_approved_by VARCHAR(255),
    score_last_edited_by VARCHAR(255) NOT NULL,
    comments TEXT,
    place VARCHAR(6),
    points INT,
    CONSTRAINT pk_prepub_results PRIMARY KEY (event_id, contestant_id),
    CONSTRAINT ck_prepub_checked CHECK (checked_approved IN ('approved', 'not approved')),
    CONSTRAINT ck_prepub_score CHECK (score >= 0),
    CONSTRAINT ck_prepub_scorer CHECK (LENGTH(TRIM(score_last_edited_by)) > 0),
    CONSTRAINT ck_prepub_attendance_score CHECK (
        (TRIM(event_attendance) = 'Completed' AND score IS NOT NULL AND place IS NULL AND points IS NULL)
        OR (TRIM(event_attendance) = 'NoShow' AND score IS NULL AND place IS NULL AND points IS NULL)
        OR (TRIM(event_attendance) = 'WalkOver' AND score IS NULL AND place IS NOT NULL
            AND place = 'First' AND points IS NOT NULL AND points >= 0)
    )
);
--rollback DROP TABLE IF EXISTS prepub_results;

--changeset bk-scotland:001-published-results
CREATE TABLE published_results (
    event_id VARCHAR(50) NOT NULL REFERENCES events(event_id),
    event_name VARCHAR(50) NOT NULL,
    event_age_group VARCHAR(50) NOT NULL,
    individual_group CHAR(10) NOT NULL,
    on_stage_off_stage CHAR(10) NOT NULL,
    contestant_id VARCHAR(50) NOT NULL REFERENCES participants(id),
    contestant_first_name VARCHAR(50) NOT NULL,
    contestant_last_name VARCHAR(50) NOT NULL,
    contestant_mission VARCHAR(50) NOT NULL,
    chest_no CHAR(10),
    score NUMERIC(12,2),
    place VARCHAR(6) NOT NULL,
    points INT NOT NULL,
    score_last_edited_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255) NOT NULL,
    approved_at TIMESTAMPTZ NOT NULL,
    certificate_printed VARCHAR(3) NOT NULL DEFAULT 'No',
    results_printed VARCHAR(3) NOT NULL DEFAULT 'No',
    is_walkover BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT pk_published_results PRIMARY KEY (event_id, contestant_id),
    CONSTRAINT ck_pub_place CHECK (place IN ('First', 'Second', 'Third')),
    CONSTRAINT ck_pub_points CHECK (points >= 0),
    CONSTRAINT ck_pub_cert CHECK (certificate_printed IN ('Yes', 'No')),
    CONSTRAINT ck_pub_printed CHECK (results_printed IN ('Yes', 'No')),
    CONSTRAINT ck_pub_walkover CHECK (
        (is_walkover = FALSE AND score IS NOT NULL)
        OR (is_walkover = TRUE AND score IS NULL AND place = 'First')
    )
);
--rollback DROP TABLE IF EXISTS published_results;

--changeset bk-scotland:001-current-event
CREATE TABLE current_event (
    id INT NOT NULL,
    current_event_name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_current_event PRIMARY KEY (id),
    CONSTRAINT ck_current_event_single CHECK (id = 1),
    CONSTRAINT ck_current_event_name CHECK (LENGTH(TRIM(current_event_name)) > 0)
);
INSERT INTO current_event (id, current_event_name) VALUES (1, 'Bible Kalothsavam - Scotland 2026');
--rollback DELETE FROM current_event WHERE id = 1; DROP TABLE IF EXISTS current_event;

