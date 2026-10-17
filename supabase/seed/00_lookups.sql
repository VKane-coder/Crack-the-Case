-- Reference data. Idempotent: safe to re-run. Levels and cases are generated (see scripts/build-seed.ts).

insert into public.specialties (slug, name, colour_token, icon, sort_order) values
  ('general-practice',       'General Practice',          'brand-teal',   'stethoscope',   1),
  ('emergency',              'Emergency',                 'brand-coral',  'siren',         2),
  ('medicine',               'Medicine',                  'brand-blue',   'heart-pulse',   3),
  ('surgery',                'Surgery',                   'brand-purple', 'scissors',      4),
  ('paediatrics',            'Paediatrics',               'brand-mint',   'baby',          5),
  ('obstetrics-gynaecology', 'Obstetrics & Gynaecology',  'brand-coral',  'flower',        6),
  ('psychiatry',             'Psychiatry',                'brand-purple', 'brain',         7),
  ('rural-indigenous-health','Rural & Indigenous Health', 'brand-teal',   'map',           8)
on conflict (slug) do update
  set name = excluded.name, colour_token = excluded.colour_token, icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.avatars (slug, name, emoji, rarity, is_default, unlock_rule, sort_order) values
  ('koala-clerk',     'Koala Clerk',      '🐨', 'common',    true,  null, 1),
  ('kookaburra',      'Kookaburra',       '🐦', 'common',    false, null, 2),
  ('penguin-pal',     'Penguin Pal',      '🐧', 'common',    false, null, 3),
  ('wombat-wonder',   'Wombat Wonder',    '🐻', 'common',    false, null, 4),
  ('quokka-cheer',    'Quokka Cheer',     '😊', 'common',    false, null, 5),
  ('echidna-expert',  'Echidna Expert',   '🦔', 'common',    false, null, 6),
  ('roo-registrar',   'Roo Registrar',    '🦘', 'rare',      false, '{"type":"level","gte":10}', 10),
  ('cockatoo-consultant','Cockatoo Consultant','🦜','epic',  false, '{"type":"level","gte":21}', 11),
  ('golden-stethoscope','Golden Stethoscope','🩺','legendary',false, '{"type":"badge","slug":"club_90"}', 12)
on conflict (slug) do update
  set name = excluded.name, emoji = excluded.emoji, rarity = excluded.rarity,
      is_default = excluded.is_default, unlock_rule = excluded.unlock_rule, sort_order = excluded.sort_order;

-- Badge criteria are declarative; the rules engine lands in M5 (src/server/gamification/badges.ts).
insert into public.badges (slug, name, description, category, tier, icon, criteria, xp_reward, is_secret, sort_order) values
  ('first_osce',          'First OSCE Completed', 'You cracked your very first case!',                         'milestone',     'bronze',  'party-popper',    '{"type":"count","metric":"consultations_completed","gte":1}', 25, false, 1),
  ('first_history',       'First History',        'Scored 70%+ in history taking for the first time.', 'history', 'bronze', 'search',         '{"type":"station","metric":"history_domain_pct","gte":70}', 25, false, 2),
  ('sherlock_symptoms',   'Sherlock Symptoms',    'Scored 85%+ in history taking in 5 stations.',              'history',       'silver',  'scan-search',     '{"type":"count_where","metric":"history_domain_pct","gte":85,"count":5}', 50, false, 3),
  ('diagnostic_detective','Diagnostic Detective', 'Led with the correct diagnosis in 10 stations.',            'history',       'gold',    'brain',           '{"type":"count_where","metric":"leading_differential_correct","eq":true,"count":10}', 100, false, 4),
  ('rapport_builder',     'Rapport Builder',      'Explored ideas, concerns and expectations in 3 stations.',  'communication', 'bronze',  'heart-handshake', '{"type":"count_where","metric":"ice_explored","eq":true,"count":3}', 25, false, 5),
  ('empathy_expert',      'Empathy Expert',       'Averaged 85%+ in communication over 10 stations.',          'communication', 'gold',    'heart',           '{"type":"avg_domain","domain":"communication","gte":85,"min_attempts":10}', 100, false, 6),
  ('calm_communicator',   'Calm Communicator',    'Scored 80%+ in communication with an angry patient.',       'communication', 'silver',  'wind',            '{"type":"station","metric":"communication_domain_pct","gte":80,"persona":"angry"}', 50, false, 7),
  ('red_flag_hunter',     'Red Flag Hunter',      'Caught every red flag in 5 stations in a row.',             'safety',        'gold',    'shield-alert',    '{"type":"consecutive","metric":"all_red_flags_elicited","count":5}', 100, false, 8),
  ('patient_protector',   'Patient Protector',    'Scored 90%+ in patient safety in 5 stations.',              'safety',        'silver',  'shield-check',    '{"type":"count_where","metric":"patient_safety_domain_pct","gte":90,"count":5}', 50, false, 9),
  ('perfect_safety',      'Perfect Safety',       'A flawless patient safety score.',                          'safety',        'emerald', 'badge-check',     '{"type":"station","metric":"patient_safety_domain_pct","gte":100}', 75, false, 10),
  ('streak_7',            '7 Day Hero',           'Practised 7 days in a row.',                                'consistency',   'bronze',  'flame',           '{"type":"streak","gte":7}', 50, false, 11),
  ('streak_30',           '30 Day Champion',      'Practised 30 days in a row. Unstoppable!',                  'consistency',   'gold',    'trophy',          '{"type":"streak","gte":30}', 200, false, 12),
  ('osce_addict',         'OSCE Addict',          'Completed 100 stations.',                                   'consistency',   'emerald', 'infinity',        '{"type":"count","metric":"consultations_completed","gte":100}', 250, false, 13),
  ('club_90',             '90 Percent Club',      'Scored 90% or more overall.',                               'milestone',     'gold',    'star',            '{"type":"station","metric":"overall_pct","gte":90}', 100, false, 14),
  ('specialty_explorer',  'Specialty Explorer',   'Completed stations in 5 different specialties.',            'specialty',     'silver',  'compass',         '{"type":"distinct_count","metric":"specialty","gte":5}', 50, false, 15),
  ('comeback_kid',        'Comeback Kid',         'Beat your previous best on a case by 20 points.',           'milestone',     'silver',  'trending-up',     '{"type":"station","metric":"improvement_pct","gte":20}', 50, false, 16),
  ('night_owl',           'Night Owl',            'Completed a station between midnight and 4am. Get some sleep!', 'consistency','bronze',  'moon',            '{"type":"station","metric":"local_hour","between":[0,3]}', 10, true, 17),
  ('early_bird',          'Early Bird',           'Completed a station before 7am.',                           'consistency',   'bronze',  'sunrise',         '{"type":"station","metric":"local_hour","between":[4,6]}', 10, true, 18)
on conflict (slug) do update
  set name = excluded.name, description = excluded.description, category = excluded.category, tier = excluded.tier,
      icon = excluded.icon, criteria = excluded.criteria, xp_reward = excluded.xp_reward,
      is_secret = excluded.is_secret, sort_order = excluded.sort_order;

insert into public.goals (slug, scope, kind, target, xp_reward) values
  ('daily-cases',    'daily',  'cases',   1,  30),
  ('weekly-cases',   'weekly', 'cases',   5,  100),
  ('weekly-minutes', 'weekly', 'minutes', 60, 50)
on conflict (slug) do update
  set scope = excluded.scope, kind = excluded.kind, target = excluded.target, xp_reward = excluded.xp_reward;

insert into public.milestones (slug, name, threshold_type, threshold) values
  ('cases-1',    'First case cracked',  'consultations', 1),
  ('cases-10',   '10 cases cracked',    'consultations', 10),
  ('cases-25',   '25 cases cracked',    'consultations', 25),
  ('cases-50',   'Half-century',        'consultations', 50),
  ('cases-100',  'Centurion',           'consultations', 100),
  ('xp-1000',    '1,000 XP',            'xp',            1000),
  ('xp-5000',    '5,000 XP',            'xp',            5000),
  ('xp-10000',   '10,000 XP',           'xp',            10000),
  ('badges-5',   'Trophy collector',    'badges',        5)
on conflict (slug) do update
  set name = excluded.name, threshold_type = excluded.threshold_type, threshold = excluded.threshold;
