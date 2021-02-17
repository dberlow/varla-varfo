/* jshint browser: true, esversion: 9, laxcomma: true, laxbreak: true */
// import getEncodeFallback from '../../app/lib/ean13Encoder/fallback.mjs';
import DOMTool from './domTool.mjs';


function addEvent(elem, eventNames, callback) {
    var eventNames_ = Array.isArray(eventNames) ? eventNames : [eventNames];
    for(let eventName of eventNames_)
        elem.addEventListener(eventName, callback);
}

function selectAddEvent(elem, selector, eventNames, callback) {
    for(let matched of elem.querySelectorAll(selector))
        addEvent(matched, eventNames, callback);
}

const CALIBRATION_OBJECTS = [
    // "w" is expected to be the longer side!
    {label: 'From your wallet', optgroup: true}
  , {label: 'Credit/ATM card', w: 85.60, h: 53.98, unit: 'mm'}  // ≈ 3.370 in × 2.125 in
  , {label: '$1: US One-Dollar Bill', w: 6.14, h: 2.61, unit: 'in'}   // ≈ 156.1 mm × 66.3 mm
  , {label: '€10: Ten Euro Note', w: 127, h: 67, unit: 'mm'}

];

const CALIBRATE_TEMPLATE = `
<h1>calibrate widget</h1>


<div>
    <label>Method:
    <select class="widget-calibrate__select-method">
        <option value="resize">Use a real world object to resize a widget on screen.</option>
        <option value="ruler">Use a ruler to measure a distance on screen.</option>
    </select></label>
</div>

<div class="widget-calibrate__resize">
    <label>Choose an entry such that at least one dimension of the real world fits onto your screen:
    <select class="widget-calibrate__resize-select_object"></select></label>
</div>

<div class="widget-calibrate__ruler">
    <label>Select a length to measure:
    <!-- NOTE: Could be any length in here, we don't even parse
    the option.value ourselves, just using option.client{Width|Height}.-->
    <select class="widget-calibrate__ruler-select_length">
        <option value="20cm">20 CSS-centimeter</option>
        <option value="10cm">10 CSS-centimeter</option>
        <option value="5cm">5 CSS-centimeter</option>
        <option value="10in">10 CSS-inch</option>
        <option value="5in">5 CSS-inch</option>
        <option value="2in">2 CSS-inch</option>
        <option value="960px">960 CSS-pixel</option>
        <option value="480px">480 CSS-pixel</option>
        <option value="96px">96 CSS-pixel</option>
    </select></label>

    <label>Measure in unit: <select class="widget-calibrate__ruler-unit">
        <option>cm</option>
        <option>mm</option>
        <option>in</option>
        <option>m</option>
    </select></select>
</div>

<div>
    <label>Switch Orientation:
        <input type="checkbox" class="widget-calibrate__set-orientation"/><span></span></label>
</div>

<div>
    <button class="widget-calibrate__button_done">Done</button>
</div>

<p class="widget-calibrate__resize">
    Resize the white rectangle to match the dimensions of the selected
    object: click or touch, and drag.</p>

<div class="widget-calibrate__resize-container widget-calibrate__resize">
    <div class="widget-calibrate__resize-box"></div>
</div>

<div class="widget-calibrate__ruler-container widget-calibrate__ruler">
    <div class="widget-calibrate__ruler-measure_box"></div>
    <label class="widget-calibrate__ruler-val_label">Enter your measurement:
    <input class="widget-calibrate__ruler-val" type="text"
        />&nbsp;<span class="widget-calibrate__ruler__show-unit"></span></label>
    <div class="widget-calibrate__ruler-feedback"></div>
</div>

<div>
    <button class="widget-calibrate__button_done">Done</button>
</div>
`;

class CalibrationWidget{
    constructor(baseElement) {
        this._baseElement = baseElement;
        this._domTool = new DOMTool(this._baseElement.ownerDocument);
        this._isActive = false;

        var dom = this._domTool.createElementfromHTML(
                'div', {'class': 'widget_calibrate'}, CALIBRATE_TEMPLATE);
        this.container = dom;

        this.selectMethod = dom.querySelector('.widget-calibrate__select-method');
        this.resizeBox = dom.querySelector('.widget-calibrate__resize-box');
        this.resizeSelectObject = dom.querySelector('.widget-calibrate__resize-select_object');
        this.setOrientation = dom.querySelector('.widget-calibrate__set-orientation');
        this.rulerSelectLength = dom.querySelector('.widget-calibrate__ruler-select_length');
        this.rulerMeasureBox = dom.querySelector('.widget-calibrate__ruler-measure_box');
        this.rulerVal = dom.querySelector('.widget-calibrate__ruler-val');
        this.rulerUnit = dom.querySelector('.widget-calibrate__ruler-unit');
        this.rulerFeedback = dom.querySelector('.widget-calibrate__ruler-feedback');
        this.rulerShowUnitAll = dom.querySelectorAll('.widget-calibrate__ruler__show-unit');

        this.dragstate = null;
        this.pinchstate = null;
        this.scale2real = 1;
        this._intialize();
    }
    _intialize() {
        addEvent(this.rulerSelectLength, 'input', ()=>this._setupRuler());
        addEvent(this.rulerUnit, 'input',()=>this._setupRuler());
        addEvent(this.rulerVal, 'input',()=>this.setRulerChange());
        selectAddEvent(this.container, '.widget-calibrate__button_done', 'click', ()=>this.close());

        addEvent(this.selectMethod, 'change', ()=>this.setMethod());
        addEvent(this.resizeBox.parentElement, 'mousedown', (e)=>this.dragStart(e));
        addEvent(this.resizeBox.parentElement, 'touchstart', (e)=>this.pinchStart(e));
        addEvent(this.resizeBox.parentElement, 'touchmove', (e)=>this.pinchMove(e));
        addEvent(this.resizeBox.parentElement, ['touchend', 'touchcancel'], (e)=>this.pinchEnd(e));
        addEvent(this.resizeBox.parentElement, 'touchstart', (e)=>this.pinchStart(e));

        addEvent(this.resizeSelectObject, 'change', (_)=>this._setupResizeBox());
        addEvent(this.setOrientation, 'change', (_)=>this._setup());

        let group = null;
        for(let [i, {label, optgroup, w, h, unit}] of CALIBRATION_OBJECTS.entries()){
            console.log(i, label);
            if(optgroup === true) // start putting stuff in optgroup
                group = this._domTool.createChildElement(this.resizeSelectObject,
                                                'optgroup', {label: label});
            else if (optgroup === false) // stop putting stuff in last optgroup
                group = null;
            else // just a normal option
                this._domTool.createChildElement(group || this.resizeSelectObject,
                    'option', {value: i}, `${label} (${w} ${unit} × ${h} ${unit})`);
        }
        this.setMethod();
    }

    get currentMethod() {
        return this.selectMethod.value;
    }

    static unitToPx(len, unit) {
        var px;
        switch(unit) {
            case('m'):
                len = len * 100;
                /* falls through*/
            case('cm'):
                len = len * 10;
                /* falls through*/
            case('mm'):
                px = len * 96 / 25.4;
                break;
            case('in'):
                px = len * 96;
                break;
            default:
                throw new Error(`Unkown unit: ${unit}`);
        }
        return px;
    }

    static pxToUnit(px, unit) {
        return px / CalibrationWidget.unitToPx(1, unit);
    }

    get isPortrait() {
        return this.setOrientation.checked;
    }

    _setupResizeBox() {
        var {w, h, unit} = CALIBRATION_OBJECTS[this.resizeSelectObject.value]
          , width, height
          ;
        width = this.scale2real * CalibrationWidget.unitToPx(w, unit);
        height = this.scale2real * CalibrationWidget.unitToPx(h, unit);
        if(this.isPortrait)
            [width, height] = [height, width];
        this.updateResizeBox(width, height);
    }

    _setupRuler() {
        var width = this.rulerSelectLength.value // can also be e.g. "80vmax"
          , height = '' // is set in css, this is to unset on orientation change
          ;

        if(this.isPortrait)
            [width, height] = [height, width];

        // This should have an indicator which side to measure,
        // maybe an arrow and sth. like "measure the {height|width}"
        this.rulerMeasureBox.style.setProperty('width', width);
        this.rulerMeasureBox.style.setProperty('height', height);

        // only when rulerSelectLength changes and on activate ...
        // (when this.rulerUnit changes ???)
        var len = CalibrationWidget.pxToUnit(
                this.isPortrait
                    ? this.rulerMeasureBox.clientHeight
                    : this.rulerMeasureBox.clientWidth,
                this.rulerUnit.value
            ) / this.scale2real;
        this.rulerVal.value = `${len.toFixed(3)}`;

        for(let elem of this.rulerShowUnitAll)
            elem.textContent = this.rulerUnit.value;

        this._updateRulerFeedback();
    }

    _updateRulerFeedback() {
        if(this.isPortrait){
            this.rulerFeedback.style.setProperty('width', '');
            this.rulerFeedback.style.setProperty('height',
                `${this.scale2real * this.rulerMeasureBox.clientHeight}px`);
        }
        else {
            this.rulerFeedback.style.setProperty('height', '');
            this.rulerFeedback.style.setProperty('width',
                `${this.scale2real * this.rulerMeasureBox.clientWidth}px`);
        }

        // Make a scale background to help measuring/controling.
        // Times two to have each stripe (50%) at one unit.
        // Meter (m) is not a CSS-unit, we use a decimeters in that case.
        // Decimeter also because a meter wide pattern won't show often.
        let rawUnit = `2${this.rulerUnit.value == 'm' ? '0cm': this.rulerUnit.value}`
         ,  scaledUnit = `calc(${rawUnit} * ${this.scale2real})`
         ;
        this.rulerMeasureBox.style.setProperty('background-size',
                                               `${rawUnit} ${rawUnit}`);
        this.rulerFeedback.style.setProperty('background-size',
                                             `${scaledUnit} ${scaledUnit}`);
    }

    _setup() {
        console.log('_setup', this.currentMethod);

        var addClass = 'widget-calibrate__is_landscape'
          , removeClass = 'widget-calibrate__is_portrait'
          ;
        if(this.isPortrait)
            [addClass, removeClass] = [removeClass, addClass];
        this.container.classList.add(addClass);
        this.container.classList.remove(removeClass);

        switch(this.currentMethod){
            case('resize'):
                this._setupResizeBox();
                break;
            case('ruler'):
                this._setupRuler();
                break;
        }
    }

    setMethod() {
        var makeClass = method=>`widget-calibrate__method-${method}`;
        for(let method of this.selectMethod.getElementsByTagName('option')){
            if(method === this.currentMethod)
                continue;
            this.container.classList.remove(makeClass(method.value));
        }
        this.container.classList.add(makeClass(this.currentMethod));
        this._setup();
    }

    activate() {
        if(this._isActive)
            return;

        this._baseElement.style.background = 'lime';
        // FIXME: must be configurable
        this._domTool.insert(this._baseElement, 'prepend', this.container);
        // Set orientation based on screen orientation.
        // Done on activate, so it's only automatic when the widget is
        // opened, not when the device is rotated and the widget is already
        // open, which would be an anti-pattern.
        var window = this.container.ownerDocument.defaultView; // fancy way to do this
        this.setOrientation.checked = window.matchMedia('(orientation: portrait)').matches === true;

        this.setMethod();// calls this._setup();
        this._isActive = true;
    }

    close() {
        if(!this._isActive)
            return;
        // event listeners are preserved
        this._domTool.removeNode(this.container);
        this._isActive = false;

    }

    dragStart(event) {
        event.preventDefault();
        if(this.dragstate !== null)
            return;
        this.dragstate = {
            eventHandlers: [
                ['mousemove', this.dragMove.bind(this), false],
                ['mouseup',  this.dragEnd.bind(this), false],
            ]
          , lastX: event.pageX
          , lastY: event.pageY
          , aspectRatio: this.resizeBox.clientWidth / this.resizeBox.clientHeight
        };

        this._baseElement.style.background = 'yellow';
        // FIXME: visualViewport.scale works on e.g. the IPhone etc. it
        // can be used to correct calibration for pinch-zoom! Doesn't work
        // on Firefox out of the box: the dom.visualviewport.enabled preferences
        // (needs to be set to true).
        // this.resizeBox.textContent = `${event.type}`;// pinch-zoom: ${visualViewport.scale}`;
        for(let eventDefinition of this.dragstate.eventHandlers)
            this._baseElement.ownerDocument.addEventListener(...eventDefinition);
    }

    resizeSetScale2Real() {
        // Picking the longer side `w`, in the hope it reduces manual measurement error.
        let { w, h, unit } = CALIBRATION_OBJECTS[this.resizeSelectObject.value]
          , clientSize = this.isPortrait
                                ? this.resizeBox.clientHeight
                                : this.resizeBox.clientWidth
          ;
        this.scale2real = clientSize / CalibrationWidget.unitToPx(w, unit);
    }

    dragEnd(event) {
        for(let eventDefinition of this.dragstate.eventHandlers)
            this._baseElement.ownerDocument.removeEventListener(...eventDefinition);
        this.resizeSetScale2Real();
        this.dragstate = null;
    }

    updateResizeBox(width, height) {
        this.resizeBox.style.setProperty('width', `${width}px`);
        this.resizeBox.style.setProperty('height', `${height}px`);
    }

    dragMove(event) {
        var widthChange = event.pageX - this.dragstate.lastX
          , heightChange = event.pageY - this.dragstate.lastY
          , width, height
          ;
        this.dragstate.lastX = event.pageX;
        this.dragstate.lastY = event.pageY;

        if(Math.abs(widthChange) >= Math.abs(heightChange)) {
            width = this.resizeBox.clientWidth + widthChange;
            height = width / this.dragstate.aspectRatio;
        }
        else {
            height = this.resizeBox.clientHeight + heightChange;
            width = height * this.dragstate.aspectRatio;
        }
        this.updateResizeBox(width, height);
    }

    static _copyTouch({ identifier, pageX, pageY }) {
        return { identifier, pageX, pageY };
    }

    pinchStart(event) {
        this.container.style.background = 'pink';
        if (event.targetTouches.length != 2)
            return;
        this.container.style.background = 'purple';
        // All 2-touch touchstart events are handled here (and end here).
        event.preventDefault();
        if(this.pinchstate !== null)
            return;

        this.pinchstate = {
            currentTouches: new Map()
          , aspectRatio: this.resizeBox.clientWidth / this.resizeBox.clientHeight
          , startWidth: this.resizeBox.clientWidth
          , startHeight: this.resizeBox.clientHeight
        };

        for (let touch of event.targetTouches)
            this.pinchstate.currentTouches.set(
                    touch.identifier, CalibrationWidget._copyTouch(touch));
    }

    pinchEnd(event) {
        if(this.pinchstate === null)
            return;
        event.preventDefault();
        // For the touchend event, it is a list of the touch points that have been removed
        for(let touch of event.changedTouches) {
            if(this.pinchstate.currentTouches.has(touch.identifier))
                this.pinchstate.currentTouches.delete(touch.identifier);
        }
        // if it's not an event it os called as a handler and
        //
        if(event && this.pinchstate.currentTouches.size == 2)
            return;

        this.container.style.background = 'cyan';
        this.resizeSetScale2Real();
        this.pinchstate = null;
    }

    static _getTouchesDistance(touches) {
        let [
            {pageX: x1, pageY: y1},
            {pageX: x2, pageY: y2}
        ] = Array.from(touches.values());
        return Math.sqrt(Math.pow(x2-x1, 2) + Math.pow(y2-y1, 2));
    }

    pinchMove(event) {
        if(this.pinchstate === null)
            return;
        this.container.style.background = 'orange';
        // Check if the there are two target touches that are the same
        // ones that started the 2-touch ...
        var newTouches = new Map();
        for (let touch of event.targetTouches) {
            if(this.pinchstate.currentTouches.has(touch.identifier))
                newTouches.set(touch.identifier, CalibrationWidget._copyTouch(touch));
        }
        if(newTouches.size !== 2)
            return;
        event.preventDefault();

        this.container.style.background = 'red';
        var lastDistance = CalibrationWidget._getTouchesDistance(this.pinchstate.currentTouches)
          , nowDistance = CalibrationWidget._getTouchesDistance(newTouches)
          , change = nowDistance - lastDistance
          , width = this.pinchstate.startWidth + change
          , height = width / this.pinchstate.aspectRatio
          ;
        this.container.style.background = 'lime';
        this.updateResizeBox(width, height);
    }

    setRulerChange() {
        var inputValue = parseFloat( this.rulerVal.value.replace(',', '.') )
          , inputValuePx
          , cssValuePx = this.isPortrait
                ? this.rulerMeasureBox.clientHeight
                : this.rulerMeasureBox.clientWidth
          , ratio
          ;
        if(inputValue !== inputValue) // NaN
            return;
        inputValuePx = CalibrationWidget.unitToPx(inputValue, this.rulerUnit.value);
        this.scale2real = cssValuePx / inputValuePx;
        this._updateRulerFeedback();
    }

}
function main() {
    // initCalibrate should only perform if the calibration widget is not already
    // active, hence, we need state!
    let calibrationWidget = new CalibrationWidget(document.body)
     , initCalibrate = evt=>calibrationWidget.activate()
     ;
    for(let initCalibrateButton of document.querySelectorAll('.ui-init-calibrate'))
        initCalibrateButton.addEventListener('click', initCalibrate);
}
main();
