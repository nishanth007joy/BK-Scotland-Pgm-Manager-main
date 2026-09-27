-- Applied automatically during server startup.
-- Preserve existing records; reject new or updated duplicate combinations.
-- Identity is first name, last name, mission, and age group; chest numbers and ID are excluded.
-- Trim surrounding spaces when comparing identity fields.
CREATE OR ALTER TRIGGER dbo.TR_Contestants_PreventDuplicates
ON dbo.Contestants
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF EXISTS (
        SELECT 1
        FROM dbo.Contestants AS c WITH (UPDLOCK, HOLDLOCK)
        WHERE EXISTS (
            SELECT 1 FROM inserted AS i
            WHERE LTRIM(RTRIM(c.[First Name])) = LTRIM(RTRIM(i.[First Name]))
              AND LTRIM(RTRIM(c.[Last Name])) = LTRIM(RTRIM(i.[Last Name]))
              AND LTRIM(RTRIM(c.Mission)) = LTRIM(RTRIM(i.Mission))
              AND LTRIM(RTRIM(c.AgeGroup)) = LTRIM(RTRIM(i.AgeGroup))
        )
        GROUP BY LTRIM(RTRIM(c.[First Name])),
            LTRIM(RTRIM(c.[Last Name])), LTRIM(RTRIM(c.Mission)),
            LTRIM(RTRIM(c.AgeGroup))
        HAVING COUNT_BIG(*) > 1
    )
        THROW 51002, 'A contestant with the same first name, last name, age group, and mission already exists. Check the existing record before adding another contestant.', 1;
END;
