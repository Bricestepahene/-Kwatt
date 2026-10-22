-- Kwatt · fondation serveur : grand livre des cauris (SPEC §7).
-- Toute écriture passe par le grand livre (apps/server/src/modules/economy/ledger.ts).

-- Détails d'affichage d'un mouvement (adversaire, quête…), jamais une phrase.
ALTER TABLE ledger_transactions ADD COLUMN meta jsonb NOT NULL DEFAULT '{}';
-- Heure réelle de l'écriture (et non le début de la transaction SQL) : plusieurs mouvements
-- écrits dans la même transaction (mise puis versement) gardent leur ordre dans le journal.
ALTER TABLE ledger_transactions ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- Séquestres génériques : mises d'une partie ('game:<id>'), pronostics ('prediction:<id>'),
-- pots de ligue ('league:<id>')… Une partie peut ainsi avoir plusieurs séquestres.
ALTER TABLE wallets ADD COLUMN escrow_key text UNIQUE;
ALTER TABLE wallets ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE wallets ADD CONSTRAINT wallets_escrow_key_check CHECK (kind <> 'escrow' OR escrow_key IS NOT NULL);
ALTER TABLE wallets ADD CONSTRAINT wallets_player_user_check CHECK (kind <> 'player' OR user_id IS NOT NULL);
ALTER TABLE wallets ADD CONSTRAINT wallets_system_code_check CHECK (kind <> 'system' OR system_code IS NOT NULL);

CREATE INDEX ledger_entries_wallet_tx ON ledger_entries (wallet_id, tx_id);
CREATE INDEX ledger_transactions_created ON ledger_transactions (created_at DESC, id DESC);

-- Un solde ne change JAMAIS hors du grand livre ----------------------------------
-- Le code du grand livre écrit d'abord les lignes du journal, déclare la transaction
-- (set_config('kwatt.ledger_tx', <id>, true)) puis met à jour les soldes. Tout autre
-- UPDATE du solde est refusé, et un portefeuille naît toujours à zéro.
CREATE FUNCTION wallets_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx text := current_setting('kwatt.ledger_tx', true);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance <> 0 THEN
      RAISE EXCEPTION 'un portefeuille naît à zéro (le grand livre crédite ensuite)';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.balance IS DISTINCT FROM OLD.balance THEN
    IF tx IS NULL OR tx = '' OR NOT EXISTS (
      SELECT 1 FROM ledger_entries
       WHERE tx_id = tx::uuid AND wallet_id = NEW.id AND balance_after = NEW.balance
    ) THEN
      RAISE EXCEPTION 'solde du portefeuille % modifié hors du grand livre', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER wallets_balance_guard_insert BEFORE INSERT ON wallets
  FOR EACH ROW EXECUTE FUNCTION wallets_balance_guard();
CREATE TRIGGER wallets_balance_guard_update BEFORE UPDATE OF balance ON wallets
  FOR EACH ROW EXECUTE FUNCTION wallets_balance_guard();
