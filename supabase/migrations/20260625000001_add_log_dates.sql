ALTER TABLE reading_logs ADD COLUMN start_date TEXT;
ALTER TABLE reading_logs ADD COLUMN end_date TEXT;
UPDATE reading_logs SET start_date = read_date WHERE start_date IS NULL;
