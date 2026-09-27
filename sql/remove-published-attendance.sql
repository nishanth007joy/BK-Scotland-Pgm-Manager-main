IF COL_LENGTH('dbo.PublishedResults', 'EventAttendence') IS NOT NULL
    ALTER TABLE dbo.PublishedResults DROP COLUMN EventAttendence;
