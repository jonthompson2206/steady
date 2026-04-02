exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = process.env;
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured: missing Strava credentials' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const params = {
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
  };

  if (body.grant_type === 'authorization_code') {
    params.grant_type = 'authorization_code';
    params.code = body.code;
  } else if (body.grant_type === 'refresh_token') {
    params.grant_type = 'refresh_token';
    params.refresh_token = body.refresh_token;
  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid grant_type' }) };
  }

  try {
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to reach Strava API' }) };
  }
};
