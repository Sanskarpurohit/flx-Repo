import createField from './form-fields.js';
import { sampleRUM } from '../../scripts/aem.js';

async function createForm(formHref) {
  const { pathname } = new URL(formHref);
  const resp = await fetch(pathname);
  if (!resp.ok) {
    throw new Error(`Failed to load form config: ${resp.status}`);
  }
  const json = await resp.json();

  const form = document.createElement('form');

  // Use submission URL from JSON if available, else fallback
  form.dataset.action = json.submission?.url || pathname.split('.json')[0];

  if (json.submission?.confirmation) {
    form.dataset.confirmation = json.submission.confirmation;
  }

  const fields = await Promise.all(json.data.map((fd) => createField(fd, form)));
  fields.forEach((field) => {
    if (field) {
      form.append(field);
    }
  });

  // Group fields into fieldsets
  const fieldsets = form.querySelectorAll('fieldset');
  fieldsets.forEach((fieldset) => {
    form.querySelectorAll(`[data-fieldset="${fieldset.name}"]`).forEach((field) => {
      fieldset.append(field);
    });
  });

  return form;
}

function generatePayload(form) {
  const payload = {};

  [...form.elements].forEach((field) => {
    if (field.name && field.type !== 'submit' && !field.disabled) {
      if (field.type === 'radio') {
        if (field.checked) payload[field.name] = field.value;
      } else if (field.type === 'checkbox') {
        if (field.checked) {
          payload[field.name] = payload[field.name]
            ? `${payload[field.name]},${field.value}`
            : field.value;
        }
      } else {
        payload[field.name] = field.value;
      }
    }
  });

  return payload;
}

function handleSubmitError(form, error) {
  console.error(error);
  form.querySelector('button[type="submit"]').disabled = false;
  sampleRUM('form:error', {
    source: '.form',
    target: error.stack || error.message || 'unknown error',
  });
}

async function handleSubmit(form) {
  if (form.getAttribute('data-submitting') === 'true') return;

  const submit = form.querySelector('button[type="submit"]');
  try {
    form.setAttribute('data-submitting', 'true');
    submit.disabled = true;

    const payload = generatePayload(form);
    console.log('Submitting payload:', payload);
    console.log('Submitting to:', form.dataset.action);

    const response = await fetch(form.dataset.action, {
      method: 'POST',
      body: JSON.stringify({ data: payload }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      sampleRUM('form:submit', {
        source: '.form',
        target: form.dataset.action,
      });
      if (form.dataset.confirmation) {
        window.location.href = form.dataset.confirmation;
      }
    } else {
      const error = await response.text();
      throw new Error(error);
    }
  } catch (e) {
    handleSubmitError(form, e);
  } finally {
    form.setAttribute('data-submitting', 'false');
  }
}

export default async function decorate(block) {
  const formLink = block.querySelector('a[href$=".json"]');
  if (!formLink) return;

  try {
    const form = await createForm(formLink.href);
    block.replaceChildren(form);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const valid = form.checkValidity();
      if (valid) {
        handleSubmit(form);
      } else {
        const firstInvalidEl = form.querySelector(':invalid:not(fieldset)');
        if (firstInvalidEl) {
          firstInvalidEl.focus();
          firstInvalidEl.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  } catch (err) {
    console.error('Form initialization failed:', err);
    block.innerHTML = '<p>Sorry, the form could not be loaded.</p>';
  }
}
