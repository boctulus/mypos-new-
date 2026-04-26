class TablerFormElements {
    static generateTextInput(id, label, placeholder = '', value = '') {
        return `
            <div class="mb-3">
                <label class="form-label" for="${id}">${label}</label>
                <input type="text" class="form-control" id="${id}" placeholder="${placeholder}" value="${value}">
            </div>
        `;
    }

    static generateDropdown(id, label, options, selectedValue = '') {
        let optionsHtml = options.map(option => {
            const isSelected = option.value === selectedValue ? 'selected' : '';
            return `<option value="${option.value}" ${isSelected}>${option.text}</option>`;
        }).join('');

        return `
            <div class="mb-3">
                <label class="form-label" for="${id}">${label}</label>
                <select class="form-select" id="${id}">
                    ${optionsHtml}
                </select>
            </div>
        `;
    }

    // Add more methods for other Tabler.io form elements as needed
}

export default TablerFormElements;