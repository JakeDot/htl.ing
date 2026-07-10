'use strict';

const config = require('./config');

function confirmSubscriptionMail(confirmUrl) {
  return {
    subject: `Anmeldung bestätigen – ${config.listName}`,
    text: [
      `Hallo,`,
      ``,
      `bitte bestätige deine Anmeldung zur Mailingliste ${config.listAddress}, indem du auf`,
      `folgenden Link klickst:`,
      ``,
      `  ${confirmUrl}`,
      ``,
      `Falls du diese Anmeldung nicht angefordert hast, kannst du diese E-Mail ignorieren –`,
      `ohne Bestätigung wird nichts abonniert.`,
      ``,
      `--`,
      `${config.listName} <${config.listAddress}>`,
      `Kontakt: ${config.adminEmail}`,
      ``,
      `(English: Please confirm your subscription to the ${config.listAddress} mailing list`,
      `by clicking the link above. If you didn't request this, just ignore this e-mail.)`,
    ].join('\n'),
  };
}

function welcomeMail(unsubscribeUrl) {
  return {
    subject: `Willkommen bei ${config.listName}`,
    text: [
      `Deine Anmeldung wurde bestätigt – du bist jetzt bei ${config.listAddress} dabei.`,
      ``,
      `Um eine Nachricht an die Liste zu senden, schreibe einfach eine E-Mail an`,
      `${config.listAddress}. Sie wird an alle Abonnentinnen und Abonnenten weitergeleitet.`,
      ``,
      `Abmelden kannst du dich jederzeit:`,
      `  - per Link: ${unsubscribeUrl}`,
      `  - oder per E-Mail an ${config.signoutAddress}`,
      ``,
      `--`,
      `${config.listName} <${config.listAddress}>`,
    ].join('\n'),
  };
}

function alreadySubscribedMail() {
  return {
    subject: `Bereits angemeldet – ${config.listName}`,
    text: [
      `Diese Adresse ist bereits für ${config.listAddress} angemeldet.`,
      `Falls du dich abmelden möchtest, schreibe eine E-Mail an ${config.signoutAddress}.`,
      ``,
      `--`,
      `${config.listName} <${config.listAddress}>`,
    ].join('\n'),
  };
}

function unsubscribedMail() {
  return {
    subject: `Abmeldung bestätigt – ${config.listName}`,
    text: [
      `Du wurdest von ${config.listAddress} abgemeldet.`,
      `Solltest du dich erneut anmelden wollen, sende eine E-Mail an ${config.signupAddress},`,
      `oder nutze das Formular auf https://htl.ing/.`,
      ``,
      `--`,
      `${config.listName} <${config.listAddress}>`,
    ].join('\n'),
  };
}

function notSubscribedMail() {
  return {
    subject: `Nicht angemeldet – ${config.listName}`,
    text: [
      `Diese Adresse ist bei ${config.listAddress} nicht angemeldet, eine Abmeldung ist`,
      `daher nicht nötig.`,
      ``,
      `--`,
      `${config.listName} <${config.listAddress}>`,
    ].join('\n'),
  };
}

function howToSubscribeMail() {
  return {
    subject: `Re: ${config.listName}`,
    text: [
      `Diese Adresse ist bei ${config.listAddress} (noch) nicht angemeldet, daher wurde`,
      `deine Nachricht nicht an die Liste weitergeleitet.`,
      ``,
      `Um dich anzumelden, sende eine E-Mail an ${config.signupAddress},`,
      `oder verwende das Formular auf https://htl.ing/.`,
      ``,
      `--`,
      `${config.listName} <${config.listAddress}>`,
    ].join('\n'),
  };
}

function listFooterText(unsubscribeUrl) {
  return [
    ``,
    `--`,
    `Du erhältst diese E-Mail, weil du bei ${config.listName} (${config.listAddress})`,
    `angemeldet bist.`,
    `Abmelden: ${unsubscribeUrl}  (oder E-Mail an ${config.signoutAddress})`,
  ].join('\n');
}

module.exports = {
  confirmSubscriptionMail,
  welcomeMail,
  alreadySubscribedMail,
  unsubscribedMail,
  notSubscribedMail,
  howToSubscribeMail,
  listFooterText,
};
