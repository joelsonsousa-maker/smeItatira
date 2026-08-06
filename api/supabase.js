const { createClient } = require('@supabase/supabase-js');

function getSupabaseClients() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || serviceRoleKey;

  if (!supabaseUrl) {
    return {
      enabled: false,
      reason: 'SUPABASE_URL não configurada.',
      client: null,
      admin: null
    };
  }

  const client = createClient(supabaseUrl, anonKey || 'placeholder', {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const admin = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : client;

  return {
    enabled: true,
    reason: null,
    client,
    admin
  };
}

async function syncUserProfile({ admin, userId, email, nome, perfil }) {
  if (!admin || !userId) {
    return null;
  }

  try {
    const payload = {
      id: userId,
      email: email || null,
      nome: nome || null,
      perfil: perfil || 'usuario'
    };

    const { error } = await admin.from('profiles').upsert(payload, { onConflict: 'id' });

    if (error) {
      console.warn('Não foi possível sincronizar o perfil no Supabase:', error.message);
      return null;
    }

    return payload;
  } catch (error) {
    console.warn('Erro inesperado ao sincronizar o perfil:', error.message);
    return null;
  }
}

async function getUserProfile({ admin, userId }) {
  if (!admin || !userId) {
    return null;
  }

  try {
    const { data, error } = await admin
      .from('profiles')
      .select('perfil, nome, email')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('Falha ao buscar perfil do usuário:', error.message);
      return null;
    }

    return data;
  } catch (error) {
    console.warn('Erro inesperado ao recuperar o perfil:', error.message);
    return null;
  }
}

module.exports = {
  getSupabaseClients,
  syncUserProfile,
  getUserProfile
};
