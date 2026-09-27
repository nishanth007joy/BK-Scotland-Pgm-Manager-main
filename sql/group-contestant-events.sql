-- Existing groups remain unassigned until an event is chosen.
IF COL_LENGTH('dbo.GroupContestants', 'EventID') IS NULL
  ALTER TABLE dbo.GroupContestants ADD EventID nvarchar(50) NULL;
IF COL_LENGTH('dbo.GroupContestants', 'EventName') IS NULL
  ALTER TABLE dbo.GroupContestants ADD EventName varchar(50) NULL;
