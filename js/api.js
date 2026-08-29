/**
 * api.js — Public API layer for app.js.
 *
 * Delegates to services.js (local logic) instead of Flask HTTP.
 * This file is the ONLY interface between app.js and the service layer.
 * All methods return Promises, matching the original fetch-based interface.
 */
const api = (() => {
  return {
    state:          ()              => services.state(),
    listHabits:     ()              => services.listHabits(),
    getHabit:       (id)            => services.getHabit(id),
    createHabit:    (body)          => services.createHabit(body),
    updateHabit:    (id, body)      => services.updateHabit(id, body),
    deleteHabit:    (id)            => services.deleteHabit(id),
    createEvent:    (habitId, body) => services.createEvent(habitId, body),
    updateEvent:    (eventId, body) => services.updateEvent(eventId, body),
    deleteEvent:    (eventId)       => services.deleteEvent(eventId),
    globalStats:    ()              => services.globalStats(),
    loadDemo:       ()              => services.loadDemo(),
    deleteDemo:     ()              => services.deleteDemo(),
    resetAll:       ()              => services.resetAll(),
    listIdentities: ()              => services.listIdentities(),
    getIdentity:    (id)            => services.getIdentity(id),
    createIdentity: (body)          => services.createIdentity(body),
    updateIdentity: (id, body)      => services.updateIdentity(id, body),
    deleteIdentity: (id)            => services.deleteIdentity(id),
    createObstacle: (habitId, body) => services.createObstacle(habitId, body),
    setIdentityLink: (habitId, body) => services.setIdentityLink(habitId, body),
    removeIdentityLink: (habitId, identityId) => services.removeIdentityLink(habitId, identityId),
    getNote:        (date)          => services.getNote(date),
    saveNote:       (date, body)    => services.saveNote(date, body),
    noteDone:       (date, habitId) => services.noteDone(date, habitId),
    weeklyReview:   ()              => services.weeklyReview(),
    saveReviewAnswer: (body)        => services.saveReviewAnswer(body),
    saveReviewSetting: (body)       => services.saveReviewSetting(body),
    getTheme:       ()              => services.getTheme(),
    saveTheme:      (body)          => services.saveTheme(body),
    submitFeedback: (body)          => services.submitFeedback(body),
  };
})();
