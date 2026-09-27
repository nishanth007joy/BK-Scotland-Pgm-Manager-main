-- Preserve historical duplicates while preventing new duplicate event/contestant pairs.
-- Lock the affected key ranges until the writer's transaction finishes, including
-- concurrent registrations. A unique index can replace this trigger after cleanup.
CREATE OR ALTER TRIGGER dbo.TR_EventRegistrations_PreventDuplicates
ON dbo.EventRegistrations
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF EXISTS (
        SELECT 1
        FROM dbo.EventRegistrations AS r WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN (SELECT DISTINCT EventID, ContestantID FROM inserted) AS changed
            ON r.EventID = changed.EventID AND r.ContestantID = changed.ContestantID
        GROUP BY r.EventID, r.ContestantID
        HAVING COUNT_BIG(*) > 1
    )
        THROW 51001, 'This contestant is already registered for this event.', 1;
END;
