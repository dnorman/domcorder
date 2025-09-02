function resetForm() {
  const form = document.querySelector('form');
  form?.reset();
}

function toggleEnablement() {
  const form = document.querySelector('form');
  const fields = form?.querySelectorAll('input, select, textarea');
  console.log(fields);
  fields?.forEach(field => {
    field.disabled = !field.disabled;
  });
}

function resetTextField(element) {
  element.value = '';
  
}

