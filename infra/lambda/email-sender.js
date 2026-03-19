/**
 * SES email sending and lead storage for AI Visibility Reports.
 *
 * Lead lifecycle:
 *   - Created with status "active" when user requests a report
 *   - Bounces/unsubscribes change status and set a 30-day TTL for auto-deletion
 *   - Complaints delete the record immediately (handled by humans first)
 *   - Only "active" leads receive emails
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const ses = new SESClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const leadsTable = process.env.LEADS_TABLE || "visibility-leads";
const fromEmail = process.env.FROM_EMAIL || "reports@synvya.com";
const siteBaseUrl = process.env.SITE_BASE_URL || "https://synvya.com";

const TTL_30_DAYS_SECONDS = 30 * 24 * 60 * 60;

// --- Lead status helpers ---

/**
 * Check if an email address is suppressed (unsubscribed or bounced).
 * Returns true if the email should NOT receive messages.
 */
export async function isEmailSuppressed(email) {
  const result = await dynamo.send(new QueryCommand({
    TableName: leadsTable,
    KeyConditionExpression: "email = :email",
    FilterExpression: "#s IN (:unsub, :bounced)",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":email": email,
      ":unsub": "unsubscribed",
      ":bounced": "bounced",
    },
    Limit: 1,
  }));
  return (result.Count || 0) > 0;
}

/**
 * Store a lead in the visibility-leads table with status "active".
 */
export async function storeLead({ email, businessName, city, neighborhood, website, placeId, jobId, resultId }) {
  const now = new Date().toISOString();
  const reportUrl = resultId ? `${siteBaseUrl}/ai-visibility/report/${resultId}` : null;

  await dynamo.send(new PutCommand({
    TableName: leadsTable,
    Item: {
      email,
      created_at: now,
      business_name: businessName,
      city,
      neighborhood: neighborhood || null,
      website: website || null,
      place_id: placeId || null,
      job_id: jobId || null,
      result_id: resultId || null,
      report_url: reportUrl,
      status: "active",
      email_sent: false,
      email_sent_at: null,
      source: "ai-visibility-form",
    },
  }));

  return now; // return created_at for later update
}

/**
 * Update a lead record after email is sent.
 */
export async function markLeadEmailSent(email, createdAt, resultId) {
  const now = new Date().toISOString();
  const reportUrl = `${siteBaseUrl}/ai-visibility/report/${resultId}`;

  await dynamo.send(new UpdateCommand({
    TableName: leadsTable,
    Key: { email, created_at: createdAt },
    UpdateExpression: "SET email_sent = :sent, email_sent_at = :sentAt, result_id = :rid, report_url = :url",
    ExpressionAttributeValues: {
      ":sent": true,
      ":sentAt": now,
      ":rid": resultId,
      ":url": reportUrl,
    },
  }));
}

/**
 * Mark all lead records for an email as unsubscribed, with 30-day TTL.
 */
export async function markEmailUnsubscribed(email) {
  const ttl = Math.floor(Date.now() / 1000) + TTL_30_DAYS_SECONDS;
  const records = await queryAllLeadRecords(email);

  for (const record of records) {
    await dynamo.send(new UpdateCommand({
      TableName: leadsTable,
      Key: { email: record.email, created_at: record.created_at },
      UpdateExpression: "SET #s = :status, unsubscribed_at = :now, #ttl = :ttl",
      ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
      ExpressionAttributeValues: {
        ":status": "unsubscribed",
        ":now": new Date().toISOString(),
        ":ttl": ttl,
      },
    }));
  }
}

/**
 * Mark all lead records for an email as bounced, with 30-day TTL.
 */
export async function markEmailBounced(email) {
  const ttl = Math.floor(Date.now() / 1000) + TTL_30_DAYS_SECONDS;
  const records = await queryAllLeadRecords(email);

  for (const record of records) {
    await dynamo.send(new UpdateCommand({
      TableName: leadsTable,
      Key: { email: record.email, created_at: record.created_at },
      UpdateExpression: "SET #s = :status, bounced_at = :now, #ttl = :ttl",
      ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
      ExpressionAttributeValues: {
        ":status": "bounced",
        ":now": new Date().toISOString(),
        ":ttl": ttl,
      },
    }));
  }
}

/**
 * Delete all lead records for an email immediately (used for complaints).
 */
export async function deleteEmailRecords(email) {
  const records = await queryAllLeadRecords(email);

  for (const record of records) {
    await dynamo.send(new DeleteCommand({
      TableName: leadsTable,
      Key: { email: record.email, created_at: record.created_at },
    }));
  }
}

/**
 * Query all lead records for a given email address.
 */
async function queryAllLeadRecords(email) {
  const result = await dynamo.send(new QueryCommand({
    TableName: leadsTable,
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: { ":email": email },
  }));
  return result.Items || [];
}

// --- Email sending ---

/**
 * Send the report email via SES.
 * Checks suppression list before sending.
 */
export async function sendReportEmail({ email, businessName, city, resultId, overallScore }) {
  // Don't send to suppressed addresses
  const suppressed = await isEmailSuppressed(email);
  if (suppressed) {
    console.log(`Skipping email to suppressed address: ${email}`);
    return;
  }

  const reportUrl = `${siteBaseUrl}/ai-visibility/report/${resultId}`;
  const unsubscribeUrl = `${siteBaseUrl}/visibility/unsubscribe?email=${encodeURIComponent(email)}`;
  const scoreDisplay = overallScore !== undefined && overallScore !== null
    ? `${Math.round(overallScore * 10) / 10}/10`
    : "";

  const htmlBody = buildHtmlEmail({ businessName, city, reportUrl, unsubscribeUrl, scoreDisplay });
  const textBody = buildTextEmail({ businessName, city, reportUrl, unsubscribeUrl, scoreDisplay });

  await ses.send(new SendEmailCommand({
    Source: `Synvya <${fromEmail}>`,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: `Your Free AI Visibility Report for ${businessName}`, Charset: "UTF-8" },
      Body: {
        Html: { Data: htmlBody, Charset: "UTF-8" },
        Text: { Data: textBody, Charset: "UTF-8" },
      },
    },
    Headers: [
      { Name: "List-Unsubscribe", Value: `<${unsubscribeUrl}>` },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ],
  }));
}

// --- Email templates ---

function buildHtmlEmail({ businessName, city, reportUrl, unsubscribeUrl, scoreDisplay }) {
  const scoreSection = scoreDisplay
    ? `<p style="font-size:28px;font-weight:bold;color:#2d8659;margin:16px 0 4px;">
        ${scoreDisplay}
      </p>
      <p style="font-size:14px;color:#64748b;margin:0 0 24px;">Overall AI Visibility Score</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;border:1px solid #e2e8f0;">
  <!-- Header -->
  <tr><td style="padding:32px 32px 0;text-align:center;">
    <p style="font-size:20px;font-weight:bold;color:#0f172a;margin:0;">Synvya</p>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:24px 32px;text-align:center;">
    <h1 style="font-size:22px;font-weight:bold;color:#0f172a;margin:0 0 16px;">
      Your Free AI Visibility Report is ready
    </h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 8px;">
      Hi there,
    </p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 8px;">
      We've analyzed how <strong>${escapeHtml(businessName)}</strong> appears when customers
      ask ChatGPT for recommendations in ${escapeHtml(city)}.
    </p>
    ${scoreSection}
    <a href="${reportUrl}" style="display:inline-block;padding:12px 28px;background-color:#2d8659;color:#ffffff;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600;margin:16px 0;">
      See your free report
    </a>
    <p style="font-size:13px;color:#94a3b8;margin:16px 0 0;line-height:1.6;text-align:left;">
      Your free report includes:<br>
      &bull; Presence &mdash; Can ChatGPT find your business?<br>
      &bull; Menu Knowledge &mdash; Does it know what you serve?<br>
      &bull; Accuracy &mdash; Is the information correct?<br>
      &bull; Actionability &mdash; Can customers take action?
    </p>
  </td></tr>
  <!-- CTA -->
  <tr><td style="padding:0 32px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;padding-top:20px;">
    <tr><td style="text-align:center;">
      <p style="font-size:15px;font-weight:600;color:#0f172a;margin:0 0 4px;">Want to improve your score?</p>
      <p style="font-size:13px;color:#64748b;margin:0 0 12px;">Synvya helps restaurants get discovered by AI assistants so you get more customers.</p>
      <a href="https://account.synvya.com" style="font-size:14px;color:#2d8659;text-decoration:underline;">Start your free trial</a>
    </td></tr>
    </table>
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center;">
    <p style="font-size:12px;color:#94a3b8;line-height:1.5;margin:0;">
      Synvya Inc. &middot; synvya@synvya.com &middot; synvya.com<br>
      You received this email because you requested an AI Visibility Report at synvya.com.<br>
      <a href="${unsubscribeUrl}" style="color:#94a3b8;">Unsubscribe</a> &middot;
      <a href="${siteBaseUrl}/privacy.html" style="color:#94a3b8;">Privacy Policy</a>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildTextEmail({ businessName, city, reportUrl, unsubscribeUrl, scoreDisplay }) {
  const scoreLine = scoreDisplay ? `\nYour overall AI Visibility Score: ${scoreDisplay}\n` : "";
  return `Your Free AI Visibility Report is ready

Hi there,

We've analyzed how ${businessName} appears when customers ask ChatGPT for recommendations in ${city}.
${scoreLine}
See your free report: ${reportUrl}

Your free report includes:
  - Presence -- Can ChatGPT find your business?
  - Menu Knowledge -- Does it know what you serve?
  - Accuracy -- Is the information correct?
  - Actionability -- Can customers take action?

---
Want to improve your score?
Synvya helps restaurants get discovered by AI assistants so you get more customers.
Start your free trial: https://account.synvya.com

Synvya Inc. | synvya@synvya.com | synvya.com
You received this email because you requested an AI Visibility Report at synvya.com.
Unsubscribe: ${unsubscribeUrl}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
