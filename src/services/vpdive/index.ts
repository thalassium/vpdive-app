/**
 * VPDive API client.
 *
 * Every shape comes from real responses recorded by `npm run probe`
 * (fixtures/), and the booking request mirrors what VPDive's own web app sends.
 *
 * Ground rules, each one a fix over the AI Studio version:
 *   - No fallback data. If VPDive does not answer, the caller gets an error and
 *     the UI says so. Showing a frozen copy of the agenda looks like it works
 *     while sending people to dives that may have moved or been cancelled.
 *   - A failed booking is reported as a failure. Never "success in demo mode".
 *   - The password is never stored. The JWT lasts 30 days (its own `exp` claim);
 *     when it expires the member logs in again.
 *   - Nothing invented: no default price, location or role.
 *
 * Un fichier par domaine : transport (rythme, cache, erreurs), auth (session),
 * calendar (agenda, inscriptions), members (membres, ma fiche), messaging
 * (messagerie), admin (validations, fiches, référentiel). L'objet `vpdive`
 * les réunit pour les écrans.
 */
import { authHeaders, getSession, login, logout, refreshPicture } from './auth';
import { deleteRegistration, fetchEventDetail, fetchEvents, fetchPricesForRole, fetchRoster, fetchRosterAndStaff, register, switchWaitingList, unregister } from './calendar';
import { fetchMemberDirectory, memberProfile, memberSheet, myAptitudeLabels, myEmergencyContact, myFile, saveEmergencyContact, searchByName, searchMembers } from './members';
import { messageList, messageNotifications, messageReply, messageStart, messageThread, userTokenOf } from './messaging';
import { capacities, capacityNames, decideValidation, isClubMember, memberForm, memberRecord, memberStatus, pendingValidations, refreshFfessmLicence, updateMember } from './admin';

export const vpdive = {
  // Session
  getSession,
  login,
  logout,
  refreshPicture,
  authHeaders,
  // Agenda et inscriptions
  fetchEvents,
  fetchEventDetail,
  fetchPricesForRole,
  register,
  unregister,
  switchWaitingList,
  deleteRegistration,
  fetchRoster,
  fetchRosterAndStaff,
  // Membres
  searchMembers,
  searchByName,
  fetchMemberDirectory,
  memberProfile,
  memberSheet,
  myFile,
  myAptitudeLabels,
  myEmergencyContact,
  saveEmergencyContact,
  // Messagerie
  messageList,
  messageThread,
  messageNotifications,
  messageReply,
  messageStart,
  userTokenOf,
  // Administration
  isClubMember,
  pendingValidations,
  decideValidation,
  capacityNames,
  capacities,
  memberForm,
  updateMember,
  refreshFfessmLicence,
  memberRecord,
  memberStatus,
};

export { VpDiveError, SessionExpiredError, FIREWALL_MESSAGE, isRateLimited, isNetwork, isSessionLost, isUnavailable, isAborted } from './transport';
export type { ReadOptions, CallPace } from './transport';
export { pictureUrl } from './parse';
export type { Session } from './auth';
export type {
  Tag,
  CalendarEvent,
  RoleOption,
  TariffOption,
  MaterialChoice,
  MaterialOption,
  RosterEntry,
  StaffEntry,
  EventDetail,
  MyRegistration,
  BookingRequest,
} from './calendar';
export type { MemberMatch, MemberInfo, EmergencyContact, MemberDocument, MemberProfile, MemberSheet } from './members';
export type { PendingValidation } from './admin';
