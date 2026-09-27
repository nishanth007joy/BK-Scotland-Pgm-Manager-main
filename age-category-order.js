// Keep age sorting consistent without changing stored category labels.
module.exports = column => `CASE REPLACE(LOWER(LTRIM(RTRIM(${column}))), ' ', '')
  WHEN '0-7' THEN 1 WHEN '8-10' THEN 2 WHEN '11-13' THEN 3
  WHEN '14-17' THEN 4 WHEN '18-24' THEN 5 WHEN '18-25' THEN 5
  WHEN '25+' THEN 6 WHEN 'under30' THEN 7 WHEN 'over30' THEN 8 WHEN '30andabove' THEN 8
  WHEN 'allages' THEN 9 ELSE 10 END`;
