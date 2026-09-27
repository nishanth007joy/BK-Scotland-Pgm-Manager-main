-- Preserve existing registrations; reject duplicate identities on insert and update.
-- Chest numbers and participant ordering do not define a group's registration.
CREATE OR ALTER TRIGGER dbo.TR_GroupContestants_PreventDuplicates
ON dbo.GroupContestants
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF EXISTS (
        SELECT 1
        FROM inserted AS i
        JOIN dbo.GroupContestants AS g WITH (UPDLOCK, HOLDLOCK)
          ON g.ID <> i.ID
         AND LTRIM(RTRIM(g.EventID)) = LTRIM(RTRIM(i.EventID))
         AND LTRIM(RTRIM(g.GroupLeaderID)) = LTRIM(RTRIM(i.GroupLeaderID))
         AND LTRIM(RTRIM(g.AgeGroup)) = LTRIM(RTRIM(i.AgeGroup))
         AND LTRIM(RTRIM(g.Mission)) = LTRIM(RTRIM(i.Mission))
    )
        THROW 51063, 'This group leader already has a registration for the same event, age group, and mission. Edit the existing registration instead.', 1;
END;
