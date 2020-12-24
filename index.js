addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function getCryptoKey() {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function isUserAlreadyRegistered(email) {
  const user = await NEWSLETTER_SUBSCRIBER_LIST.get(email)
  return user != null
}

/**
 * @param {strign} email
 * @param {string} hostname
 */
async function sendEmail(email, hostname) {
  const url = 'https://api.sendgrid.com/v3/mail/send'

  const emailAddress = new TextEncoder().encode(email)

  const signature = await crypto.subtle.sign(
    'HMAC',
    await getCryptoKey(),
    emailAddress,
  )

  const base64Signature = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  )

  const init = {
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + SENDGRID_TOKEN,
    },
    method: 'POST',
    body: JSON.stringify({
      personalizations: [
        {
          to: [
            {
              email: email,
            },
          ],
          dynamic_template_data: {
            confirm_link:
              'https://' +
              hostname +
              '/confirm?email=' +
              encodeURIComponent(email) +
              '&code=' +
              encodeURIComponent(base64Signature),
          },
        },
      ],
      from: {
        email: 'newsletter@gatekeeper.page',
      },
      template_id: TEMPLATE_ID,
    }),
  }

  await fetch(url, init)
  await addNotConfirmedUserToList(email)
}

/**
 * @param {string} email
 */
async function addNotConfirmedUserToList(email) {
  await NEWSLETTER_SUBSCRIBER_LIST.put(email, 'not_confirmed')
}

/**
 * @param {string} email
 */
async function markUserConfirmed(email) {
  await uploadContact(email)

  await NEWSLETTER_SUBSCRIBER_LIST.put(email, 'confirmed')
}

/**
 * @param {string} email
 */
async function uploadContact(email) {
  const url = 'https://api.sendgrid.com/v3/marketing/contacts'

  const init = {
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + SENDGRID_TOKEN,
    },
    method: 'PUT',
    body: JSON.stringify({
      list_ids: [LIST_ID],
      contacts: [
        {
          email: email.toLowerCase(),
        },
      ],
    }),
  }

  await fetch(url, init)
}

async function isValidSignature(email, signature) {
  const sig = Uint8Array.from(atob(signature), c => c.charCodeAt(0))

  return await crypto.subtle.verify(
    'HMAC',
    await getCryptoKey(),
    sig,
    new TextEncoder().encode(email),
  )
}

/**
 * Respond with hello worker text
 * @param {Request} request
 */
async function handleRequest(request) {
  const requestUrl = new URL(request.url)

  if (requestUrl.pathname == '/subscribe') {
    const email = requestUrl.searchParams.get('email')

    if (email == null) {
      return new Response(
        JSON.stringify(
          { success: false, error: 'NO_EMAIL_PROVIDED' },
          { headers: { 'content-type': 'text/plain' } },
        ),
      )
    }

    const isAlreadySubscribed = await isUserAlreadyRegistered(email)

    if (isAlreadySubscribed) {
      return new Response(
        JSON.stringify({ success: false, error: 'ALREADY_SUBSCRIBED' }),
      )
    } else {
      await sendEmail(email, requestUrl.hostname)
      return new Response(JSON.stringify({ success: true }))
    }
  }

  if (requestUrl.pathname == '/confirm') {
    const email = requestUrl.searchParams.get('email')
    const signature = requestUrl.searchParams.get('code')

    const isValidSignatureResult = await isValidSignature(email, signature)

    if (isValidSignatureResult) {
      await markUserConfirmed(email)
      return Response.redirect(SUCCESS_PAGE, 307)
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'INVALID_CODE' }),
      )
    }
  }

  return new Response('Not found', {
    headers: { 'content-type': 'text/plain' },
  })
}
