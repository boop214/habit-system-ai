/* Minimal fetch wrapper around the local REST API. */
const api = (() => {
  async function request(method, url, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      const message =
        (data && data.errors && Object.values(data.errors)[0]) ||
        (data && data.error) ||
        `Error ${res.status}`;
      throw new Error(message);
    }
    return data;
  }
  return {
    state: () => request("GET", "/api/state"),
    listHabits: () => request("GET", "/api/habits"),
    getHabit: (id) => request("GET", `/api/habits/${id}`),
    createHabit: (body) => request("POST", "/api/habits", body),
    updateHabit: (id, body) => request("PUT", `/api/habits/${id}`, body),
    deleteHabit: (id) => request("DELETE", `/api/habits/${id}`),
    createEvent: (habitId, body) => request("POST", `/api/habits/${habitId}/events`, body),
    updateEvent: (eventId, body) => request("PUT", `/api/events/${eventId}`, body),
    deleteEvent: (eventId) => request("DELETE", `/api/events/${eventId}`),
    globalStats: () => request("GET", "/api/stats/global"),
    loadDemo: () => request("POST", "/api/demo"),
    deleteDemo: () => request("DELETE", "/api/demo"),
    resetAll: () => request("POST", "/api/reset"),
    listIdentities: () => request("GET", "/api/identities"),
    getIdentity: (id) => request("GET", `/api/identities/${id}`),
    createIdentity: (body) => request("POST", "/api/identities", body),
    updateIdentity: (id, body) => request("PUT", `/api/identities/${id}`, body),
    deleteIdentity: (id) => request("DELETE", `/api/identities/${id}`),
    createObstacle: (habitId, body) => request("POST", `/api/habits/${habitId}/obstacles`, body),
    setIdentityLink: (habitId, body) => request("POST", `/api/habits/${habitId}/identity-links`, body),
    removeIdentityLink: (habitId, identityId) => request("DELETE", `/api/habits/${habitId}/identity-links/${identityId}`),
    getNote: (date) => request("GET", `/api/notes/${date}`),
    saveNote: (date, body) => request("PUT", `/api/notes/${date}`, body),
    noteDone: (date, habitId) => request("POST", `/api/notes/${date}/done/${habitId}`),
    weeklyReview: () => request("GET", "/api/review/weekly"),
    saveReviewAnswer: (body) => request("PUT", "/api/review/weekly", body),
    saveReviewSetting: (body) => request("PUT", "/api/settings/review", body),
    getTheme: () => request("GET", "/api/settings/theme"),
    saveTheme: (body) => request("PUT", "/api/settings/theme", body),
    submitFeedback: (body) => request("POST", "/api/feedback", body),
  };
})();
