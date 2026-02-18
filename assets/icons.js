(function mountIcons(){
  const set = (id, svg) => {
    const el = document.getElementById(id);
    if(el) el.innerHTML = svg;
  };

  const stroke = `stroke="white" stroke-opacity=".78" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

  set("iconCalendar", `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M8 3v3M16 3v3" ${stroke}/>
      <path d="M4.5 9h15" stroke="white" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
      <path d="M6 6h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
        stroke="white" stroke-opacity=".72" stroke-width="2"/>
    </svg>
  `);

  set("iconBuilding", `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 20V6a2 2 0 0 1 2-2h6v16" stroke="white" stroke-opacity=".72" stroke-width="2" stroke-linejoin="round"/>
      <path d="M14 20V10a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10" stroke="white" stroke-opacity=".72" stroke-width="2" stroke-linejoin="round"/>
      <path d="M8 8h2M8 12h2M8 16h2" stroke="white" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `);

  set("iconChart", `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 19V5" stroke="white" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
      <path d="M4 19h16" stroke="white" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
      <path d="M7 15l3-3 3 2 5-6" ${stroke}/>
    </svg>
  `);

  set("iconLock", `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="white" stroke-opacity=".72" stroke-width="2" stroke-linecap="round"/>
      <path d="M6 11h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
        stroke="white" stroke-opacity=".78" stroke-width="2" stroke-linejoin="round"/>
    </svg>
  `);
})();
