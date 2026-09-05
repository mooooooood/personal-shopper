const byId=id=>document.getElementById(id);
const status=byId('request-status');
byId('prepare-request').addEventListener('click',()=>{
 const item=byId('item'),country=byId('country'),link=byId('link');
 for(const field of [item,country]){if(!field.value.trim()){status.textContent='Please add the product description and delivery country.';field.focus();return;}}
 if(!link.checkValidity()){link.reportValidity();return;}
 byId('request-message').value=`Hello, I’d like help sourcing a product from China.\n\nProduct: ${item.value.trim()}\nReference link: ${link.value.trim()||'I can share a photo or more details separately'}\nQuantity: ${byId('quantity').value.trim()||'To be confirmed'}\nDelivery country: ${country.value.trim()}\nBudget / other details: ${byId('notes').value.trim()||'To be discussed'}\n\nPlease help confirm availability, specifications, total costs and delivery options before purchase.`;
 byId('request-result').hidden=false;status.textContent='Your enquiry is ready. Edit or copy it, then send it using our contact details.';byId('request-message').focus();
});
byId('copy-request').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(byId('request-message').value);status.textContent='Copied. Send the message to us when you’re ready.';}
 catch{byId('request-message').focus();byId('request-message').select();status.textContent='Select Copy or press Ctrl/Cmd+C to copy the highlighted message.';}
});
byId('email-request')?.addEventListener('click',e=>{
 e.currentTarget.href=`mailto:${encodeURIComponent(e.currentTarget.dataset.email)}?subject=${encodeURIComponent('China sourcing enquiry')}&body=${encodeURIComponent(byId('request-message').value)}`;
});
