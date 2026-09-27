-- Preserve existing records while preventing new or updated duplicate combinations.
CREATE OR ALTER TRIGGER dbo.TR_Events_PreventDuplicates
ON dbo.Events
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF EXISTS (
        SELECT 1 FROM dbo.Events AS e WITH (UPDLOCK, HOLDLOCK)
        WHERE EXISTS (
            SELECT 1 FROM inserted AS i
            WHERE LTRIM(RTRIM(e.EventName)) = LTRIM(RTRIM(i.EventName))
              AND LTRIM(RTRIM(e.EventAgeGroup)) = LTRIM(RTRIM(i.EventAgeGroup))
              AND LTRIM(RTRIM(e.IndividualGroup)) = LTRIM(RTRIM(i.IndividualGroup))
              AND LTRIM(RTRIM(e.OnStageOffStage)) = LTRIM(RTRIM(i.OnStageOffStage))
        )
        GROUP BY LTRIM(RTRIM(e.EventName)), LTRIM(RTRIM(e.EventAgeGroup)),
            LTRIM(RTRIM(e.IndividualGroup)), LTRIM(RTRIM(e.OnStageOffStage))
        HAVING COUNT_BIG(*) > 1
    )
        THROW 51003, 'An event with these details already exists.', 1;
END;
