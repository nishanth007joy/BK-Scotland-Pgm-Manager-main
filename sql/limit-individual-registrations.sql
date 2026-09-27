-- Count individual registrations across both stages, per contestant.
-- Existing records are preserved. Inserts and updates cannot exceed the limit.
CREATE OR ALTER TRIGGER dbo.TR_EventRegistrations_LimitIndividualItems
ON dbo.EventRegistrations
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted WHERE LOWER(LTRIM(RTRIM(IndividualGroup))) = 'individual') RETURN;

    IF EXISTS (
        SELECT r.ContestantID
        FROM dbo.EventRegistrations AS r WITH (UPDLOCK, HOLDLOCK)
        WHERE LOWER(LTRIM(RTRIM(r.IndividualGroup))) = 'individual'
          AND r.ContestantID IN (
              SELECT i.ContestantID FROM inserted AS i
              WHERE LOWER(LTRIM(RTRIM(i.IndividualGroup))) = 'individual'
          )
        GROUP BY r.ContestantID
        HAVING COUNT_BIG(*) > 3
    )
        THROW 51004, 'A contestant can register for a maximum of 3 individual items across on-stage and off-stage events combined.', 1;
END;
