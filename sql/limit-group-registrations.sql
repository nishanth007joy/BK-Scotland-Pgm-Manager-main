-- Count each group registration once per person, across leader and participant roles.
CREATE OR ALTER TRIGGER dbo.TR_GroupContestants_LimitGroupEvents
ON dbo.GroupContestants
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT members.ContestantID
    FROM dbo.GroupContestants g WITH (UPDLOCK, HOLDLOCK)
    CROSS APPLY (SELECT DISTINCT NULLIF(LTRIM(RTRIM(v.ID)), '') AS ContestantID
      FROM (VALUES (g.GroupLeaderID), (g.Participant1ID), (g.Participant2ID), (g.Participant3ID), (g.Participant4ID), (g.Participant5ID), (g.Participant6ID), (g.Participant7ID), (g.Participant8ID), (g.Participant9ID)) v(ID)) members
    WHERE members.ContestantID IS NOT NULL AND members.ContestantID IN (
      SELECT NULLIF(LTRIM(RTRIM(v.ID)), '') FROM inserted i
      CROSS APPLY (VALUES (i.GroupLeaderID), (i.Participant1ID), (i.Participant2ID), (i.Participant3ID), (i.Participant4ID), (i.Participant5ID), (i.Participant6ID), (i.Participant7ID), (i.Participant8ID), (i.Participant9ID)) v(ID)
    )
    GROUP BY members.ContestantID
    HAVING COUNT_BIG(*) > 3
  )
    THROW 51005, 'A contestant can register for a maximum of 3 group events, including group leader and participant roles.', 1;
END;
