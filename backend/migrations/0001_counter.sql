CREATE TABLE counter (
    id BIGINT PRIMARY KEY CHECK (id = 1),
    value BIGINT NOT NULL CHECK (value >= 0)
);
