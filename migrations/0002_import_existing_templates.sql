-- Imported from data/spiel-templates.xlsx; generated 2026-11-17T10:52:02.851Z
INSERT INTO spiel_templates (id, name, spiel, active) VALUES ('2', 'Spiel', 'Called the store at {{TIME}} to verify the espresso machine issue. The machine is powered on but frozen and unable to pull shots.', 1) ON CONFLICT(id) DO UPDATE SET name=excluded.name, spiel=excluded.spiel, active=excluded.active;
