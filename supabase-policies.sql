-- Supabase: profiles table hardening
-- 1) Ensure 'perfil' column exists with default 'usuario'
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS perfil text DEFAULT 'usuario';

-- 2) Ensure a simple trigger sets default perfil if client omits it
CREATE OR REPLACE FUNCTION public.profiles_set_default_perfil()
RETURNS trigger AS $$
BEGIN
  IF NEW.perfil IS NULL OR NEW.perfil = '' THEN
    NEW.perfil := 'usuario';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_default_perfil ON public.profiles;
CREATE TRIGGER trg_profiles_default_perfil
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_set_default_perfil();

-- 3) Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4) Helper: allow checking whether the requester is an admin (used in policies)
CREATE OR REPLACE FUNCTION public.requester_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.perfil = 'admin'
  );
$$;

-- 5) Policies
-- SELECT: allow users to select their own profile or allow admins to select any
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id OR public.requester_is_admin()
  );

-- INSERT: allow public inserts but enforce that perfil must be 'usuario' (or omitted),
-- admins may insert with any perfil.
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT
  WITH CHECK (
    (NEW.perfil IS NULL OR NEW.perfil = 'usuario') OR public.requester_is_admin()
  );

-- UPDATE: allow users to update their own profile (except changing perfil to admin),
-- and allow admins to update any profile (including changing perfil to admin).
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  USING (
    auth.uid() = id OR public.requester_is_admin()
  )
  WITH CHECK (
    -- Either the requester is admin, or the perfil is unchanged / remains a non-admin value
    public.requester_is_admin() OR (NEW.perfil = OLD.perfil OR NEW.perfil = 'usuario')
  );

-- DELETE: allow users to delete their own profile only if they are authenticated, allow admins to delete any
DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE
  USING (
    auth.uid() = id OR public.requester_is_admin()
  );

-- Notes for deployer:
--  * The function public.requester_is_admin() relies on auth.uid() being set by a valid
--    Supabase JWT session. Admin operations using the Service Role Key will bypass RLS.
--  * Public signups from client-side should normally write profiles with perfil omitted,
--    which the trigger will set to 'usuario'. The INSERT policy ensures clients cannot set
--    perfil='admin' unless the requester already has admin privileges.
