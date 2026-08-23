self.addEventListener("push",event=>{
  if(!event.data)return;
  const data=event.data.json();
  event.waitUntil(self.registration.showNotification(data.title||"Rutina Aether + Elahe",{
    body:data.body||"",
    icon:data.icon||"/icon.svg",
    tag:data.tag,
    data:data.data
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:"window"}).then(clients=>{
    for(const client of clients){
      if(client.url.startsWith(self.location.origin)&&"focus" in client)return client.focus();
    }
    return self.clients.openWindow("/");
  }));
});