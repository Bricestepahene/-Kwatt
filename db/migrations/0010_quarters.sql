-- Kwatt · comptes : quartiers (écran 05 « Premier lancement », écran 36, D-11).
-- Un quartier = pays + ville + quartier ; « name » NULL désigne la ville entière
-- (diaspora, ou un quartier absent de la liste). La liste de départ est dans 0011.
-- Le choix du joueur est gardé dans profiles.quarter (colonne de 0001), qui devient une
-- référence vers quarters(id). Changement : une fois par saison (mois civil, heure du Cameroun).

CREATE TABLE quarters (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z]{2}(-[a-z0-9]+)+$'),   -- 'cm-douala-akwa', 'fr-paris'
  country     char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),            -- ISO 3166-1 alpha-2
  city        text NOT NULL,                       -- nom courant (français pour les villes francophones)
  city_en     text,                                -- nom anglais quand il diffère (« London »)
  name        text,                                -- quartier ; NULL = toute la ville
  active      boolean NOT NULL DEFAULT true,       -- retiré de la liste sans casser les profils
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Texte de recherche sans accents ni capitales (« deido douala »). lower() ne connaît que
  -- l'ASCII avec une collation C : les capitales accentuées sont aussi dans translate().
  search_key  text GENERATED ALWAYS AS (
    translate(
      lower(coalesce(name, '') || ' ' || city || ' ' || coalesce(city_en, '')),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ''’-',
      'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy   '
    )
  ) STORED,
  UNIQUE NULLS NOT DISTINCT (country, city, name)
);
CREATE INDEX quarters_country_city ON quarters (country, city);

-- Choix du joueur ---------------------------------------------------------------
ALTER TABLE profiles
  ADD CONSTRAINT profiles_quarter_fkey FOREIGN KEY (quarter) REFERENCES quarters(id),
  ADD COLUMN quarter_since      timestamptz,   -- date du choix du quartier actuel
  ADD COLUMN quarter_changed_at timestamptz;   -- dernier CHANGEMENT (le premier choix ne compte pas)
CREATE INDEX profiles_quarter ON profiles (quarter) WHERE quarter IS NOT NULL;
